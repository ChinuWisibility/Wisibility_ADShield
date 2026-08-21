import mongoose from "mongoose";

const auditCommentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    entityType: {
      type: String,
      index: true,
      enum: ["VIOLATION", "EXCEPTION", "CAMPAIGN", "REQUEST"],
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    comment: { type: String },
    isPrivate: { type: Boolean, default: false },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    postedAt: { type: Date, index: true },
    editedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "audit_comments" },
);

export default mongoose.model("AuditComment", auditCommentSchema);
