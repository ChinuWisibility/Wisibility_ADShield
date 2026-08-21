import PostureFeatureTabsView from "../../../components/security/PostureFeatureTabsView";
import { KERBEROS_FEATURES } from "../securityFeatureMeta";

export default function KerberosSecurityView() {
  return (
    <PostureFeatureTabsView
      title="Kerberos Risks"
      description="Kerberoastable accounts, AS-REP roastable users, pre-authentication settings, and SPN misconfigurations"
      emptyDescription="Kerberos risk analysis requires a completed LDAP posture scan."
      features={KERBEROS_FEATURES}
      queryKeyPrefix="kerberos"
    />
  );
}
