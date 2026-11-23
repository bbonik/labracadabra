/**
 * The whole AWS deployment in one stack: CloudFront + S3 for the web app, Cognito (users, identity pool,
 * circle groups) and the IAM roles that enforce per-person and per-circle access to the data bucket, the
 * S3 → SQS → Lambda extraction pipeline, and the alarms and budget that guard cost.
 */
import * as path from "node:path";
import { contentSecurityPolicy } from "./csp";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_budgets as budgets,
  aws_cloudfront as cf,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwa,
  aws_cognito as cognito,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as les,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_s3_notifications as s3n,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  aws_sqs as sqs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface PmtProps extends StackProps {
  /** globally-unique prefix for the Cognito login domain, e.g. "smith-labracadabra" */
  authDomainPrefix: string;
  /** where budget / failure alerts go */
  alertEmail: string;
  /** monthly budget (USD) for this account; alerts at 50 % / 100 % actual and 100 % forecast */
  monthlyBudgetUsd: number;
  /** model + effort used by the extractor */
  model: string;
  effort: string;
  /** extra OAuth callback URLs (e.g. http://localhost:5199/ for local dev against AWS) */
  extraCallbackUrls: string[];
  /** sharing circles: id + display name. Members are managed with scripts/members.sh (no redeploy). */
  circles: { id: string; name: string }[];
  /** who the invitation email says invited the new member, e.g. "Alex" */
  inviterName: string;
  /** documents with more pages are refused before any model call */
  maxPages: number;
  /** require an authenticator app (TOTP) for every member, instead of leaving it optional */
  requireMfa: boolean;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class PmtStack extends Stack {
  constructor(scope: Construct, id: string, props: PmtProps) {
    super(scope, id, props);

    // ───────────── storage ─────────────
    const logsBucket = new s3.Bucket(this, "AccessLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const siteBucket = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ───────────── web distribution (CloudFront + OAC, strict security headers) ─────────────
    const headers = new cf.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: contentSecurityPolicy([
            `https://cognito-identity.${this.region}.amazonaws.com`,
            `https://${props.authDomainPrefix}.auth.${this.region}.amazoncognito.com`,
            `https://*.s3.${this.region}.amazonaws.com`,
            "https://*.s3.amazonaws.com",
          ]),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cf.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cf.HeadersReferrerPolicy.NO_REFERRER },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: "X-Robots-Tag", value: "noindex, nofollow", override: true }],
      },
    });

    const dist = new cf.Distribution(this, "Web", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: "cloudfront/",
    });
    const siteUrl = `https://${dist.distributionDomainName}`;

    // ───────────── private data bucket ─────────────
    const dataBucket = new s3.Bucket(this, "Data", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true, // protects against accidental overwrites/deletes
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: "data/",
      removalPolicy: RemovalPolicy.RETAIN, // medical records: never deleted by a stack teardown
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(60) },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) }, // uploads to users/ and circles/
      ],
      cors: [
        {
          allowedOrigins: [siteUrl, ...props.extraCallbackUrls.map((u) => new URL(u).origin)],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
    });

    // ───────────── auth: Cognito user pool (admin-created users only) + identity pool ─────────────
    const userPool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      // sent by admin-create-user (scripts/members.sh); {username} and {####} are filled in by Cognito
      userInvitation: {
        emailSubject: "You're invited to Labracadabra",
        emailBody: [
          `<p>Hi,</p>`,
          `<p>${esc(props.inviterName)} has invited you to <b>Labracadabra</b>, a private place for the family's lab results.</p>`,
          `<p>Open: <a href="https://${dist.distributionDomainName}">https://${dist.distributionDomainName}</a></p>`,
          `<p>Sign in with<br>Email: {username}<br>Temporary password: <b>{####}</b></p>`,
          `<p>You'll choose your own password when you first sign in. The temporary password expires in 7 days; ` +
            `if it does, ask ${esc(props.inviterName)} to send a new invitation.</p>`,
          `<p>Not expecting this email? You can ignore it.</p>`,
        ].join(""),
      },
      autoVerify: { email: true },
      mfa: props.requireMfa ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const domain = userPool.addDomain("Login", {
      cognitoDomain: { domainPrefix: props.authDomainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const client = userPool.addClient("Web", {
      generateSecret: false, // public SPA client, PKCE
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${siteUrl}/`, ...props.extraCallbackUrls],
        logoutUrls: [`${siteUrl}/`, ...props.extraCallbackUrls],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
    new cognito.CfnManagedLoginBranding(this, "LoginBranding", {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const identityPool = new cognito.CfnIdentityPool(this, "Identities", {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{ clientId: client.userPoolClientId, providerName: userPool.userPoolProviderName, serverSideTokenCheck: true }],
    });
    // every user's private folder is named after their identity id: never let a stack change recreate the pool
    identityPool.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // ───────────── access: private folder + sharing circles, all enforced by IAM ─────────────
    // Every signed-in user may read/write their own users/<identity id>/ (IAM policy variable, filled in by AWS).
    // A circle is a pair of Cognito groups, each mapped to an IAM role:
    //   circle-<id>       → read/write circles/<id>/*   (see, upload, correct, remove)
    //   circle-<id>-view  → read-only  circles/<id>/*
    // Users get credentials for a circle's role only if their ID token lists it (cognito:roles), i.e. only if an
    // admin added them to the group. Every role also carries the private-folder access.
    const own = "users/${cognito-identity.amazonaws.com:sub}";
    const webIdentity = () =>
      new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: { "cognito-identity.amazonaws.com:aud": identityPool.ref },
          "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" },
        },
        "sts:AssumeRoleWithWebIdentity",
      );
    const userRole = (id: string, circle?: { id: string; write: boolean }) => {
      const role = new iam.Role(this, id, { assumedBy: webIdentity(), maxSessionDuration: Duration.hours(1) });
      const prefixes = [own];
      role.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject"], resources: [`${dataBucket.bucketArn}/${own}/*`] }));
      if (circle) {
        const c = `circles/${circle.id}`;
        prefixes.push(c);
        role.addToPolicy(
          new iam.PolicyStatement({
            actions: circle.write ? ["s3:GetObject", "s3:PutObject"] : ["s3:GetObject"],
            resources: [`${dataBucket.bucketArn}/${c}/*`],
          }),
        );
      }
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:ListBucket"],
          resources: [dataBucket.bucketArn],
          conditions: { StringLike: { "s3:prefix": prefixes.map((p) => `${p}/*`) } },
        }),
      );
      return role;
    };

    const authRole = userRole("AuthenticatedRole");
    const circleConfig: { id: string; name: string; editRoleArn: string; viewRoleArn: string }[] = [];
    props.circles.forEach((c, i) => {
      const tag = c.id.replace(/(^|-)([a-z0-9])/g, (_m, _d, ch: string) => ch.toUpperCase());
      const edit = userRole(`Circle${tag}Edit`, { id: c.id, write: true });
      const view = userRole(`Circle${tag}View`, { id: c.id, write: false });
      // lower precedence number wins as cognito:preferred_role; editing beats viewing if someone is in both
      new cognito.CfnUserPoolGroup(this, `Circle${tag}EditGroup`, {
        userPoolId: userPool.userPoolId, groupName: `circle-${c.id}`, roleArn: edit.roleArn, precedence: 10 + 2 * i,
        description: `${c.name}: can see, upload, correct and remove`,
      });
      new cognito.CfnUserPoolGroup(this, `Circle${tag}ViewGroup`, {
        userPoolId: userPool.userPoolId, groupName: `circle-${c.id}-view`, roleArn: view.roleArn, precedence: 11 + 2 * i,
        description: `${c.name}: view only`,
      });
      circleConfig.push({ id: c.id, name: c.name, editRoleArn: edit.roleArn, viewRoleArn: view.roleArn });
    });

    new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityRoles", {
      identityPoolId: identityPool.ref,
      roles: { authenticated: authRole.roleArn },
      // "Token": the browser may ask for any role listed in the user's ID token (cognito:roles); users in no
      // circle get the private-only role
      roleMappings: {
        cognito: {
          identityProvider: `${userPool.userPoolProviderName}:${client.userPoolClientId}`,
          type: "Token",
          ambiguousRoleResolution: "AuthenticatedRole",
        },
      },
    });

    // ───────────── extraction pipeline: S3 → SQS → Lambda ─────────────
    const dlq = new sqs.Queue(this, "ExtractDLQ", { retentionPeriod: Duration.days(14), enforceSSL: true });
    const queue = new sqs.Queue(this, "ExtractQueue", {
      visibilityTimeout: Duration.minutes(16),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 2 },
      enforceSSL: true,
    });
    // Only uploaded documents and corrections.json trigger the extractor — not the JSON files it writes itself
    // (results, status, upload progress, spend log), which would otherwise each cost a pointless invocation.
    // The browser lower-cases file extensions on upload, so these suffixes cover every accepted file.
    // (the bucket only holds users/… and circles/…, so a suffix filter is enough)
    for (const suffix of [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", "/corrections.json"]) {
      dataBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(queue), { suffix });
    }

    const keyParam = "/pmt/anthropic-api-key";
    const fn = new lambda.Function(this, "Extractor", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: "pmt.lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../build/lambda")),
      memorySize: 1024,
      timeout: Duration.minutes(15),
      reservedConcurrentExecutions: 2, // hard cap on parallel spend
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        ANTHROPIC_KEY_PARAM: keyParam,
        PMT_MODEL: props.model,
        PMT_EFFORT: props.effort,
        PMT_MAX_PAGES: String(props.maxPages),
      },
      logGroup: new logs.LogGroup(this, "ExtractorLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    });
    fn.addEventSource(new les.SqsEventSource(queue, { batchSize: 1 }));
    for (const prefix of ["users/*", "circles/*"]) {
      dataBucket.grantReadWrite(fn, prefix);
      dataBucket.grantDelete(fn, prefix);
    }
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${keyParam}`],
      }),
    );

    // ───────────── alerts & cost guardrails ─────────────
    const topic = new sns.Topic(this, "Alerts", { enforceSSL: true });
    topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    new cw.Alarm(this, "ExtractionFailures", {
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "A document failed extraction twice and landed in the DLQ",
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwa.SnsAction(topic));
    new cw.Alarm(this, "ExtractorThrottles", {
      metric: fn.metricInvocations({ period: Duration.hours(1), statistic: "Sum" }),
      threshold: 200, // ≈ far more uploads than a family makes; signals abuse or a loop
      evaluationPeriods: 1,
      alarmDescription: "Unusually many extractor invocations in an hour",
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwa.SnsAction(topic));

    const notify = (threshold: number, type: "ACTUAL" | "FORECASTED") => ({
      notification: { comparisonOperator: "GREATER_THAN", notificationType: type, threshold, thresholdType: "PERCENTAGE" },
      subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
    });
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `${id}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: "USD" },
      },
      notificationsWithSubscribers: [notify(50, "ACTUAL"), notify(100, "ACTUAL"), notify(100, "FORECASTED")],
    });

    // ───────────── site deployment + runtime config ─────────────
    new s3deploy.BucketDeployment(this, "DeploySite", {
      destinationBucket: siteBucket,
      distribution: dist,
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "../../web/dist")),
        s3deploy.Source.jsonData("config.json", {
          mode: "aws",
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: client.userPoolClientId,
          authDomain: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
          identityPoolId: identityPool.ref,
          dataBucket: dataBucket.bucketName,
          circles: circleConfig,
        }),
      ],
      memoryLimit: 512,
    });

    new CfnOutput(this, "SiteUrl", { value: siteUrl });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "Circles", { value: props.circles.map((c) => c.id).join(",") || "(none)" });
    new CfnOutput(this, "DataBucketName", { value: dataBucket.bucketName });
    new CfnOutput(this, "ApiKeyParameter", { value: keyParam });
  }
}
