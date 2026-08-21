export default function RemediationEmptyState({ icon, title, description, action }) {
  return (
    <div className="re-empty-state">
      {icon && <div className="re-empty-state__icon">{icon}</div>}
      <h3 className="re-empty-state__title">{title}</h3>
      {description && <p className="re-empty-state__desc">{description}</p>}
      {action && <div className="re-empty-state__action">{action}</div>}
    </div>
  );
}
