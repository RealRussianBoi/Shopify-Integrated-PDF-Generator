// ✅ Updated LoadingAndFinalizationAlert.jsx
// (same behavior, just 2-space indents)

import PropTypes from "prop-types";

//Mui Imports
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";

/**
 * @param {bool} visible - Either hides or shows the Component.
 * @param {bool} loading - Displays either a <CircularProgress/> or an <Alert/>.
 * @param {string} severity - Determines the severity of the <Alert/>. Possible severities are ["success", "info", "warning", "error"].
 * @param {string} finalResultText - Determines the text used in the <Alert/>.
 * @returns {React.JSX.Element}
 */
function LoadingAndFinalizationAlert({ visible, loading, severity, finalResultText }) {
  return (
    <>
      {visible && (
        loading ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <CircularProgress sx={{ my: "20px" }} />
          </div>
        ) : (
          <Alert
            severity={severity}
            variant="filled"
            sx={{ width: "100%", my: "20px", textAlign: "center" }}
          >
            {finalResultText}
          </Alert>
        )
      )}
    </>
  );
}

LoadingAndFinalizationAlert.propTypes = {
  visible: PropTypes.bool.isRequired,
  loading: PropTypes.bool.isRequired,
  severity: PropTypes.oneOf(["success", "info", "warning", "error"]).isRequired,
  finalResultText: PropTypes.string.isRequired,
};

export default LoadingAndFinalizationAlert;