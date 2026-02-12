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

  const upperNavBarRef = useRef(null);
  const [navbarActions, setNavbarActions] = useState(null);

  // Start with a sensible default, then measure the real height via ResizeObserver
  const [navBarMargin, setNavBarMargin] = useState(isSm ? 72 : 80);

  useEffect(() => {
    // keep fallback in sync with breakpoint changes (before measurement)
    setNavBarMargin((prev) => (Number.isFinite(prev) ? prev : isSm ? 72 : 80));
  }, [isSm]);

  useEffect(() => {
    if (!upperNavBarRef.current) return;

    const updateHeight = () => {
      const h = upperNavBarRef.current?.offsetHeight;
      if (Number.isFinite(h) && h > 0) setNavBarMargin(h);
    };

    const observer = new ResizeObserver(updateHeight);
    observer.observe(upperNavBarRef.current);

    updateHeight();

    return () => observer.disconnect();
  }, []);

  return (
    <BrowserRouter>
      <UpperNavbar reference={upperNavBarRef} actions={navbarActions} />

      {/* This is the "space" for the fixed AppBar */}
      <Box sx={{ pt: `${navBarMargin + 10}px`, pb: "10px" }}>
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