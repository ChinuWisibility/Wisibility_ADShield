export default function AccessRevokeFlowBanner() {
  return (
    <div className="re-flow-banner re-flow-banner--enterprise" role="note">
      <p className="re-flow-banner__title">Enterprise access revoke model</p>
      <p className="re-flow-banner__lead">
        Certification Revoke — Enterprise is a queue-first remediation flow. The revoke button records
        the decision only; the scheduler and workflow handle provisioning, ITSM, and final verification.
      </p>
      <ol className="re-flow-banner__steps">
        <li>
          <strong>Decision</strong> — Manager revokes access; certification shows Revoke in progress.
        </li>
        <li>
          <strong>Queue</strong> — Global Rule Set maps ACCESS_REVOKE to the enterprise workflow. Task
          status is New (not running yet).
        </li>
        <li>
          <strong>Scheduler</strong> — Picks New tasks on the tenant interval and starts the workflow.
        </li>
        <li>
          <strong>Workflow</strong> — Verifies access, queues provisioning, creates an ITSM ticket, and
          monitors until removal is confirmed.
        </li>
        <li>
          <strong>Complete</strong> — Queue task closes; certification entitlement becomes Revoked.
        </li>
      </ol>
    </div>
  );
}
