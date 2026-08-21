import {
  fingerprintConfiguration,
  normalizeConfiguration,
  resolveExecutionConfigFromSnapshot,
  versionToApi,
} from "./assessmentVersionService.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const a = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=1)" },
      { featureKey: "inactive_users", enabled: false, implemented: true },
    ],
  });
  const b = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=1)" },
      { featureKey: "inactive_users", enabled: false, implemented: true },
    ],
  });
  assert(a.contentFingerprint === b.contentFingerprint, "identical configs must match");

  const c = normalizeConfiguration({
    features: [
      { featureKey: "disabled_users", enabled: true, implemented: true, ldapFilter: "(x=2)" },
    ],
  });
  assert(a.contentFingerprint !== c.contentFingerprint, "changed filter must differ");

  const cfg = resolveExecutionConfigFromSnapshot(a);
  assert(cfg.features.includes("disabled_users"), "enabled feature missing");
  assert(!cfg.features.includes("inactive_users"), "disabled feature should be excluded");

  const legacy = versionToApi({
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    assessmentId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    applicationId: "cccccccccccccccccccccccc",
    versionNumber: 0,
    configSnapshot: a,
    contentFingerprint: a.contentFingerprint,
  });
  assert(legacy.versionNumber === 0, "version 0 mapping");
  assert(fingerprintConfiguration(a) === a.contentFingerprint, "fingerprint helper");

  console.log("assessmentVersionService.test.js: PASS");
}

run();
