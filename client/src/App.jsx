import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// ─────────────── Purchase Orders ───────────────
import ManagePurchaseOrder from "./Pages/Purchase Orders/ManagePurchaseOrders";


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/purchase-orders/add" replace />} />
        <Route path="/purchase-orders/add" element={<ManagePurchaseOrder pageType="Add" />} />
        <Route path="/purchase-orders/:poPk" element={<ManagePurchaseOrder pageType="Edit" />} />
      </Routes>
    </BrowserRouter>
  );
}