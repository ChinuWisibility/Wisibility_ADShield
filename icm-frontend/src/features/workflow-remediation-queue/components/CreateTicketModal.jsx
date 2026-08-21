import { useState } from "react";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export default function CreateTicketModal({ open, onClose, onSubmit, subjectCount, loading }) {
  const [form, setForm] = useState({
    itsmEmail: "",
    title: "Workflow Remediation Ticket",
    description: "",
    priority: "MEDIUM",
    dueDate: "",
    additionalNotes: "",
  });
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!isValidEmail(form.itsmEmail)) {
      setError("A valid ITSM admin email is required.");
      return;
    }
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to create ticket.");
    }
  };

  return (
    <div className="isc-modal-overlay open" role="presentation" onClick={onClose}>
      <div className="isc-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="isc-modal-header">
          <div className="isc-modal-title">Create ITSM Ticket</div>
          <button type="button" className="isc-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="isc-modal-desc">{subjectCount} subject(s) will be included in this ticket.</p>
        <form onSubmit={handleSubmit} style={{ padding: "0 20px 8px" }}>
          <label className="wrq-modal-field">
            <span>ITSM Admin Email</span>
            <input
              type="email"
              value={form.itsmEmail}
              onChange={(e) => setForm({ ...form, itsmEmail: e.target.value })}
              required
              autoFocus
            />
          </label>
          <label className="wrq-modal-field">
            <span>Title</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="wrq-modal-field">
            <span>Priority</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="wrq-modal-field">
            <span>Due Date</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </label>
          <label className="wrq-modal-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          {error && <p style={{ color: "#b42318", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
          <div className="isc-modal-footer">
            <button type="button" className="isc-btn isc-btn-outline" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="isc-btn isc-btn-primary" disabled={loading}>
              {loading ? "Creating…" : "Create Ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
