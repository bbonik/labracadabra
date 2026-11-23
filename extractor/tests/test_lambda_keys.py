import os

os.environ.setdefault("DATA_BUCKET", "test-bucket")
os.environ.setdefault("AWS_DEFAULT_REGION", "eu-west-1")

from pmt.lambda_handler import KEY_RE  # noqa: E402

UID = "eu-west-1:1b2c3d4e-0000-4000-8000-123456789abc"


def test_inbox_upload_matches():
    m = KEY_RE.match(f"users/{UID}/profiles/me/inbox/0f8fad5b-d9cb-469f-a165-70867728950e/2025-11-01 (all).pdf")
    assert m and m["name"] == "2025-11-01 (all).pdf" and m["root"] == f"users/{UID}/profiles/me"


def test_circle_profiles_match():
    m = KEY_RE.match("circles/parents/profiles/mum/inbox/0f8fad5b-d9cb-469f-a165-70867728950e/scan.jpg")
    assert m and m["root"] == "circles/parents/profiles/mum" and m["name"] == "scan.jpg"
    assert KEY_RE.match("circles/home/profiles/kid-1/corrections.json")["corr"]


def test_corrections_match():
    assert KEY_RE.match(f"users/{UID}/profiles/kid-1/corrections.json")["corr"]


def test_own_outputs_and_traversal_are_ignored():
    for k in [
        f"users/{UID}/profiles/me/results.json",
        f"users/{UID}/profiles/me/docs/abcd.pdf",
        f"users/{UID}/profiles/me/inbox/not-a-uuid/x.pdf",
        f"users/{UID}/profiles/../inbox/0f8fad5b-d9cb-469f-a165-70867728950e/x.pdf",
        "users/x/profiles/me/corrections.json",
        "circles/Parents/profiles/mum/corrections.json",
        "circles/parents/mum/corrections.json",
        "other/parents/profiles/mum/corrections.json",
    ]:
        assert KEY_RE.match(k) is None, k
