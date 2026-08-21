import PostureFeatureTabsView from "../../../components/security/PostureFeatureTabsView";
import { COMPUTER_FEATURES } from "../securityFeatureMeta";

export default function ComputerSecurityView() {
  return (
    <PostureFeatureTabsView
      title="Computer Security"
      description="Disabled and inactive computers, OS inventory gaps, OU placement, duplicate SPNs, and ownership"
      emptyDescription="Computer security requires a completed LDAP posture scan with synced computer objects."
      features={COMPUTER_FEATURES}
      queryKeyPrefix="computer"
    />
  );
}
