//General Use Imports
import { useState, useEffect, useRef, useMemo } from "react";
import PropTypes from "prop-types";

//MUI Imports
import {
  Avatar,
  Box,
  Paper,
  Typography,
  Divider,
  Switch,
  FormControlLabel,
} from "@mui/material";
import { styled } from "@mui/system";

//Custom Imports
import { useTheme } from "../../context/ThemeContext";

const UserProfileContainer = styled(Box)({
  position: "relative",
  display: "inline-block",
});

const UserAvatar = styled(Avatar, {
  shouldForwardProp: (prop) => prop !== "darkMode",
})(({ darkMode }) => ({
  cursor: "pointer",
  backgroundColor: darkMode ? "#3b82f6" : "#1e40af",
  color: "#ffffff",
  fontWeight: "bold",
  transition: "transform 0.2s",
  "&:hover": {
    transform: "scale(1.05)",
  },
}));

const UserProfileDropdown = styled(Paper, {
  shouldForwardProp: (prop) => prop !== "darkMode",
})(({ darkMode }) => ({
  position: "absolute",
  top: "100%",
  right: 0,
  marginTop: "8px",
  width: "280px",
  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
  borderRadius: "12px",
  zIndex: 1000,
  backgroundColor: darkMode ? "#1f2937" : "#ffffff",
  color: darkMode ? "#f3f4f6" : "#111827",
  overflow: "hidden",
}));

const UserProfileHeader = styled(Box)({
  padding: "16px",
  display: "flex",
  alignItems: "center",
});

const UserProfileAction = styled(Box, {
  shouldForwardProp: (prop) => prop !== "darkMode",
})(({ darkMode }) => ({
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  cursor: "pointer",
  "&:hover": {
    backgroundColor: darkMode ? "#374151" : "#f3f4f6",
  },
}));

const CompanyItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== "darkMode",
})(({ darkMode }) => ({
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  cursor: "pointer",
  "&:hover": {
    backgroundColor: darkMode ? "#374151" : "#f3f4f6",
  },
}));

const CompanyAvatar = styled(Avatar, {
  shouldForwardProp: (prop) => prop !== "darkMode",
})(({ darkMode }) => ({
  width: "28px",
  height: "28px",
  fontSize: "12px",
  backgroundColor: darkMode ? "#4b5563" : "#e5e7eb",
  color: darkMode ? "#e5e7eb" : "#4b5563",
  marginRight: "10px",
}));

const UserProfile = ({ userData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { darkMode, toggleDarkMode } = useTheme();
  const dropdownRef = useRef(null);

  const staticCompanies = useMemo(
    () => [
      { pk: 1, name: "I am Richard Pashko" },
      { pk: 2, name: "Please Hire Me" },
    ],
    []
  );

  const displayName = String(userData || "Demo User").trim() || "Demo User";

  const getInitials = (name) => {
    if (!name) return "?";
    const n = String(name).trim();
    if (!n) return "?";

    if (n.includes(" ")) {
      const parts = n.split(" ").filter(Boolean);
      const first = parts[0]?.charAt(0) || "?";
      const last = parts[parts.length - 1]?.charAt(0) || "?";
      return (first + last).toUpperCase();
    }
    return n.substring(0, 2).toUpperCase();
  };

  const handleAvatarClick = () => setIsOpen((prev) => !prev);

  const handleManageAccount = () => {
    console.log("Manage account (static placeholder)");
    setIsOpen(false);
  };

  const handleCompanyClick = (company) => {
    console.log("Selected company (static placeholder):", company);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <UserProfileContainer ref={dropdownRef}>
      <UserAvatar darkMode={darkMode} onClick={handleAvatarClick}>
        {getInitials(displayName)}
      </UserAvatar>

      {isOpen && (
        <UserProfileDropdown darkMode={darkMode}>
          <UserProfileHeader>
            <Box>
              <Typography
                variant="subtitle1"
                fontWeight="bold"
                sx={{ fontSize: "0.95rem" }}
              >
                {displayName}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  mt: 0.25,
                  fontSize: "0.8rem",
                  color: darkMode ? "#9ca3af" : "#6b7280",
                }}
              >
                demo.user@testproject.local
              </Typography>
            </Box>
          </UserProfileHeader>

          <Divider sx={{ backgroundColor: darkMode ? "#374151" : "#e5e7eb" }} />

          <UserProfileAction darkMode={darkMode} onClick={handleManageAccount}>
            <Typography sx={{ fontSize: "0.85rem" }}>Edit Profile</Typography>
          </UserProfileAction>

          <Divider sx={{ backgroundColor: darkMode ? "#374151" : "#e5e7eb" }} />

          <Box sx={{ py: 1 }}>
            <Typography
              variant="caption"
              sx={{
                px: 2,
                color: darkMode ? "#9ca3af" : "#6b7280",
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
            >
              YOUR COMPANIES
            </Typography>

            {staticCompanies.map((company) => (
              <CompanyItem
                key={company.pk}
                darkMode={darkMode}
                onClick={() => handleCompanyClick(company)}
              >
                <CompanyAvatar darkMode={darkMode}>
                  {String(company.name || "?").charAt(0).toUpperCase()}
                </CompanyAvatar>
                <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
                  {company.name}
                </Typography>
              </CompanyItem>
            ))}
          </Box>

          <Divider sx={{ backgroundColor: darkMode ? "#374151" : "#e5e7eb" }} />

          <Box sx={{ px: 2, py: 1.25 }}>
            <FormControlLabel
              sx={{ m: 0, width: "100%", display: "flex", justifyContent: "space-between" }}
              control={
                <Switch
                  checked={!!darkMode}
                  onChange={toggleDarkMode}
                  inputProps={{ "aria-label": "Toggle dark mode" }}
                />
              }
              label={
                <Typography sx={{ fontSize: "0.85rem" }}>
                  {darkMode ? "Dark mode" : "Light mode"}
                </Typography>
              }
              labelPlacement="start"
            />
          </Box>
        </UserProfileDropdown>
      )}
    </UserProfileContainer>
  );
};

UserProfile.propTypes = {
  userData: PropTypes.string,
};

export default UserProfile;