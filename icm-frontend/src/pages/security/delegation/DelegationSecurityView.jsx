import PostureFeatureTabsView from "../../../components/security/PostureFeatureTabsView";
import { DELEGATION_FEATURES } from "../securityFeatureMeta";

export default function DelegationSecurityView() {
  return (
    <PostureFeatureTabsView
      title="Delegation Risks"
      description="Unconstrained, constrained, and resource-based delegation exposure across users and computers"
      emptyDescription="Delegation risk analysis requires a completed LDAP posture scan."
      features={DELEGATION_FEATURES}
      queryKeyPrefix="delegation"
    />
  );
}
