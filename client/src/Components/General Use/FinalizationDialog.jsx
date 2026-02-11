// General Use Imports
import PropTypes from "prop-types";
import { useState, useEffect } from "react";

// MUI Imports
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

function FinalizationDialog({ onClose, open, loadingResultText, severity, finalResultText }) {
  const [isOpen, setOpen] = useState(false);
  const [severityOptions] = useState(["success", "info", "warning", "error"]);

  useEffect(() => {
    setOpen(open);
  }, [open]);

  return (
    <Dialog
      fullWidth={true}
      maxWidth="sm"
      open={isOpen}
      onClose={(event, reason) => {
        if (reason !== "backdropClick" && reason !== "escapeKeyDown") {
          return; // Only close when triggered by code
        }
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& .MuiDialog-paper": {
          textAlign: "center",
          padding: "20px",
        },
      }}
    >
      <DialogContent sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Alert severity={severity} sx={{ width: '100%', mb: '20px' }}>
          {severity === severityOptions[1] ? loadingResultText : finalResultText}
        </Alert>
        {severity === severityOptions[1] && <CircularProgress />}
        {["success", "warning", "error"].some((s) => s == severity) && (
          <Button
            variant="outlined"
            onClick={onClose}
            sx={{ position: 'relative', right: '1%' }}
          >
            Return
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

FinalizationDialog.propTypes = { 
  onClose: PropTypes.func.isRequired,
  open: PropTypes.bool.isRequired,
  loadingResultText: PropTypes.string.isRequired,
  severity: PropTypes.string.isRequired,
  finalResultText: PropTypes.oneOfType([PropTypes.string, PropTypes.object]).isRequired,
};

export default FinalizationDialog