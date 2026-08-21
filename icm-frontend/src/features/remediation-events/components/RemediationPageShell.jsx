import { Link } from "react-router-dom";

export default function RemediationPageShell({
  eyebrow = "Governance",
  title,
  subtitle,
  breadcrumbs = [],
  actions,
  children,
  variant = "default",
}) {
  return (
    <div className={`re-page re-page--${variant}`}>
      <div className="re-page__hero">
        <div className="re-page__hero-inner">
          {breadcrumbs.length > 0 && (
            <nav className="re-breadcrumb" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, idx) => (
                <span key={crumb.label} className="re-breadcrumb__segment">
                  {idx > 0 && <span className="re-breadcrumb__sep" aria-hidden>/</span>}
                  {crumb.to ? (
                    <Link to={crumb.to} className="re-breadcrumb__link">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="re-breadcrumb__current">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          <div className="re-page__hero-row">
            <div className="re-page__hero-text">
              {eyebrow && <span className="re-page__eyebrow">{eyebrow}</span>}
              <h1 className="re-page__title">{title}</h1>
              {subtitle && <p className="re-page__subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="re-page__actions">{actions}</div>}
          </div>
        </div>
      </div>

      <div className="re-page__body">
        <div className="re-page__body-inner">{children}</div>
      </div>
    </div>
  );
}
