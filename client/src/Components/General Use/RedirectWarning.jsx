// RedirectWarning.jsx
import PropTypes from "prop-types";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

function RedirectWarning({
  open,
  onClose,          // called when user clicks X or backdrop
  onStay,           // called when user clicks "Stay"
  onLeave,          // called when user clicks "Leave page"
  title = "Leave page with unsaved changes?",
  message = "Leaving this page will delete all unsaved changes.",
  stayText = "Stay",
  leaveText = "Leave page",
  disableLeave = false,
  disableStay = false,
}) {
  const handleStay = () => {
    onStay?.();
    onClose?.();
  };

  const handleLeave = () => {
    onLeave?.();
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, py: 2 }}>
        {title}

        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{
            position: "absolute",
            right: 10,
            top: 10,
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 0, pb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            onClick={handleStay}
            disabled={disableStay}
          >
            {stayText}
          </Button>

          <Button
            variant="contained"
            onClick={handleLeave}
            disabled={disableLeave}
            sx={{
              // "Leave page" red button similar to screenshot
              bgcolor: "error.main",
              "&:hover": { bgcolor: "error.dark" },
            }}
          >
            {leaveText}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

RedirectWarning.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  onStay: PropTypes.func,
  onLeave: PropTypes.func,

  title: PropTypes.string,
  message: PropTypes.string,
  stayText: PropTypes.string,
  leaveText: PropTypes.string,

  disableLeave: PropTypes.bool,
  disableStay: PropTypes.bool,
};

export default RedirectWarning;