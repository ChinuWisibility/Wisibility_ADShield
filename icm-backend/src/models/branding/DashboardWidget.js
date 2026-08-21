import mongoose from "mongoose";

const dashboardWidgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    widgetType: {
      type: String,
      enum: ["SOD_SUMMARY", "CERT_PROGRESS", "RISK_SCORE", "ORPHAN_COUNT"],
    },
    position: { type: mongoose.Schema.Types.Mixed },
    config: { type: mongoose.Schema.Types.Mixed },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "dashboard_widgets" },
);

dashboardWidgetSchema.index({ userId: 1, widgetType: 1 });

export default mongoose.model("DashboardWidget", dashboardWidgetSchema);
