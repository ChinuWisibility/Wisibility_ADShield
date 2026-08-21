// ReviewDecisionModal.jsx
import React, { useState, useEffect, useRef } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Typography,
    Box,
    Chip,
    CircularProgress,
} from "@mui/material";

export default function ReviewDecisionModal({ open, onClose, onSubmit, item, decision }) {
    const [comment, setComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const textRef = useRef(null);

    useEffect(() => {
        if (open) {
            setComment("");
            setSubmitting(false);
            setTimeout(() => {
                if (textRef.current) textRef.current.focus();
            }, 50);
        } else {
            setSubmitting(false);
        }
    }, [open, item, decision]);

    const isRevoke = decision === "Revoked";

    const handleSubmitClick = async () => {
        if (isRevoke && !comment.trim()) return;
        try {
            setSubmitting(true);
            const result = onSubmit ? onSubmit(comment) : null;
            if (result && typeof result.then === "function") {
                await result;
            }
            setSubmitting(false);
            onClose && onClose();
        } catch (err) {
            console.error("ReviewDecisionModal submit error:", err);
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            handleSubmitClick();
        }
    };

    return (
        <Dialog
            open={open}
            onClose={() => { if (!submitting) onClose && onClose(); }}
            fullWidth
            maxWidth="sm"
            aria-labelledby="review-decision-title"
            keepMounted
        >
            <DialogTitle id="review-decision-title">
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Typography variant="h6">Confirm Decision</Typography>
                    <Chip
                        label={decision || "Decision"}
                        color={isRevoke ? "error" : "success"}
                        size="medium"
                        aria-live="polite"
                    />
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {!item ? (
                    <Typography variant="body1">No item selected.</Typography>
                ) : (
                    <>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                            You are about to <strong>{decision}</strong> access for{" "}
                            <strong>{item?.name || item?.displayName || "this user"}.</strong>
                        </Typography>

                        <TextField
                            inputRef={textRef}
                            autoFocus
                            margin="dense"
                            id="comment"
                            label={isRevoke ? "Comment (required for revoke)" : "Comment (optional)"}
                            type="text"
                            fullWidth
                            multiline
                            minRows={3}
                            maxRows={8}
                            variant="outlined"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            onKeyDown={handleKeyDown}
                            required={isRevoke}
                            disabled={submitting}
                            aria-required={isRevoke}
                        />

                        {isRevoke && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                                A comment is required when revoking access. On submit you will choose which access revoke workflow runs (Global Rule Set default is pre-selected).
                            </Typography>
                        )}
                    </>
                )}
            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                <Button
                    onClick={() => { if (!submitting) onClose && onClose(); }}
                    color="inherit"
                    disabled={submitting}
                >
                    Cancel
                </Button>

                <Button
                    onClick={handleSubmitClick}
                    variant="contained"
                    color={isRevoke ? "error" : "success"}
                    disabled={!item || submitting || (isRevoke && !comment.trim())}
                    startIcon={submitting ? <CircularProgress size={18} /> : null}
                >
                    {submitting ? "Submitting..." : "Submit Decision"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
