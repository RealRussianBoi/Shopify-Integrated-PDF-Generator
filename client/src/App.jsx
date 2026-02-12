// General Use Imports
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useState, useRef, useEffect } from "react";

// MUI Imports
import Box from "@mui/material/Box";
import { useMediaQuery as useMuiMediaQuery, useTheme as useMuiTheme } from "@mui/material";

// Custom Imports
import ManagePurchaseOrder from "./Pages/Purchase Orders/ManagePurchaseOrders";
import UpperNavbar from "./Components/General Use/UpperNavbar";

function CenterLayout() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Outlet />
    </Box>
  );
};

export default function App() {
  const muiTheme = useMuiTheme();
  const isSm = useMuiMediaQuery(muiTheme.breakpoints.down("sm"));

  const [navbarActions, setNavbarActions] = useState(null);

  return (
    <BrowserRouter>
      <UpperNavbar actions={navbarActions} />

      {/* This is the "space" for the fixed AppBar */}
      <Box sx={{ pt: `${90}px`, pb: "10px" }}>
        <Routes>
          <Route element={<CenterLayout />}>
            <Route path="/" element={<Navigate to="/purchase-order/add" replace />} />
            <Route
              path="/purchase-order/add"
              element={<ManagePurchaseOrder setNavbarActions={setNavbarActions} />}
            />
            <Route path="*" element={<Navigate to="/purchase-order/add" replace />} />
          </Route>
        </Routes>
      </Box>
    </BrowserRouter>
  );
}