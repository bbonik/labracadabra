#!/usr/bin/env node
/**
 * CDK entry point: reads deploy settings (CDK context `-c key=value`, or PMT_* environment variables) and
 * instantiates the single Labracadabra stack. See the README's "Deploy options" table.
 */
import { App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { PmtStack } from "../lib/pmt-stack";

const app = new App();
const ctx = (k: string, d?: string) => {
  const v = app.node.tryGetContext(k) ?? process.env[`PMT_${k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}`] ?? d;
  if (v === undefined) throw new Error(`missing context "${k}" (cdk deploy -c ${k}=...)`);
  return String(v);
};

new PmtStack(app, ctx("stackName", "Labracadabra"), {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx("region", process.env.CDK_DEFAULT_REGION ?? "eu-west-1") },
  authDomainPrefix: ctx("authDomainPrefix"),
  alertEmail: ctx("alertEmail"),
  monthlyBudgetUsd: Number(ctx("monthlyBudgetUsd", "10")),
  model: ctx("model", "claude-opus-5-5"),
  effort: ctx("effort", "medium"),
  inviterName: ctx("inviterName", "A family member"),
  // refuse documents longer than this before any model call (cost guard)
  maxPages: Number(ctx("maxPages", "100")),
  // -c requireMfa=true: every member must set up an authenticator app (TOTP) at sign-in
  requireMfa: ctx("requireMfa", "false") === "true",
  extraCallbackUrls: ctx("extraCallbackUrls", "").split(",").filter(Boolean),
  // -c circles="home:Our home,parents:Parents"   (id[:display name], comma-separated)
  circles: ctx("circles", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, ...name] = s.split(":");
      if (!/^[a-z0-9-]{1,30}$/.test(id)) throw new Error(`circle id "${id}": use lower-case letters, digits and dashes`);
      return { id, name: name.join(":").trim() || id[0].toUpperCase() + id.slice(1) };
    }),
});

// cdk-nag v3: the pack attaches itself to the given scope
if (app.node.tryGetContext("nag") === "true") new AwsSolutionsChecks(app, { verbose: true });
