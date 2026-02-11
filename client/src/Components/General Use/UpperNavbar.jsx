// General Use Imports
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

// Custom Imports
import UserProfile from "./UserProfile";

const COLORS = {
  drawerBg: "#172554", // blue-950
  text: "#ffffff",
};

function UpperNavbar({ userData, reference = null, actions }) {
  return (
    <AppBar
      ref={reference}
      position="fixed"
      sx={{
        bgcolor: COLORS.drawerBg,
        color: COLORS.text,
      }}
    >
      <Toolbar sx={{ bgcolor: COLORS.drawerBg, color: COLORS.text }}>
        {/* Left: Logo */}
        <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0 }}>
          <Box component="span" sx={{ color: "#60A5FA" }}>
            PO{" "}
          </Box>
          Generator
        </Typography>

        {/* Center: Navbar Actions */}
        <Box sx={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          {actions && (
            <Box sx={{ display: "flex", gap: 1, maxWidth: 560, width: "100%", justifyContent: "center" }}>
              {actions}
            </Box>
          )}
        </Box>

        {/* Right: User Profile */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <UserProfile />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

UpperNavbar.propTypes = {
  userData: PropTypes.string,
  reference: PropTypes.object,
  actions: PropTypes.element,
};

export default UpperNavbar;