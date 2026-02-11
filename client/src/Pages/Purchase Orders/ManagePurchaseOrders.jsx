//General use imports.
import axios from "axios";
import PropTypes from "prop-types";
import { useContext, useEffect, useMemo, useState, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";

//MUI imports.
import { Alert, Autocomplete, Box, Button, Chip,
  Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormHelperText, Grid, IconButton, InputAdornment,
  MenuItem, Select, Snackbar, TextField, Typography, 
  useMediaQuery as useMuiMediaQuery, useTheme as useMuiTheme, } from "@mui/material";
import CachedRoundedIcon from "@mui/icons-material/CachedRounded";
import DeleteIcon from "@mui/icons-material/Delete";
import QuestionMarkIcon from "@mui/icons-material/QuestionMark";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { DataGrid, GridActionsCellItem, useGridApiRef, GridEditInputCell, } from "@mui/x-data-grid";
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CloseIcon from "@mui/icons-material/Close";
import FileDownloadIcon from "@mui/icons-material/FileDownload";

//Custom components.
import QuickCreateVendorComponent from "../../Components/Vendors/QuickCreateVendorComponent";
import FinalizationDialog from "../../Components/General Use/FinalizationDialog";
import LoadingAndFinalizationAlert from "../../Components/General Use/LoadingAndFinalizationAlert";
import { useTheme } from "../../context/ThemeContext";
import PriceAugmentComponent from "../../Components/General Use/PriceAugmentComponent";
import WORLD_CURRENCIES from "../../utils/Currencies/WORLD_CURRENCIES";
import ProductBrowser from "../../Components/Product Browsing/ProductBrowser";
import RedirectWarning from "../../Components/General Use/RedirectWarning";

// Postgres type limits
const PG_INT_MAX = 2147483647;                // INTEGER max
const PG_FLOAT4_MAX = 3.402823466e38;         // REAL (float4) max finite magnitude

// Explicit varchar(n) constraints from po_list
const MAX_VENDOR_NOTE = 5000;                 // vendorNote VARCHAR(5000)
const MAX_SHIPPING_CARRIER = 500;             // shippingCarrier VARCHAR(500)

// Practical UI caps for "unbounded VARCHAR" fields (Postgres VARCHAR without length is unlimited)
const MAX_TRACKING = 255;
const MAX_REFERENCE = 255;

function ManagePurchaseOrder({ setNavbarActions = () => {} }) {
  const { darkMode } = useTheme();

  const navigate = useNavigate();

  const muiTheme = useMuiTheme();
  const isMobile = useMuiMediaQuery(muiTheme.breakpoints.down("md"));

  const [finalizationController, setFinalizationController] = useState({
    visible: true,
    disableFields: true,
    loading: true,
    severity: "error",
    finalResultText: "",
  });

  const [finalDialog, setFinalDialog] = useState({
    open: false,
    loadingText: "Saving Purchase Order...",
    severity: "info",
    severityText: "",
  });

  // These are used both for reset-adornments and for comparisons.
  const [defaultValues, setDefaultValues] = useState({
    poNumber: "",
    vendorPk: "",
    destinationPk: "",
    paymentTerms: "",
    vendorCurrency: "USD",

    // Shipment Dates
    dueDate: null,
    dateToShip: null,
    dateVoid: null,

    // Shipment details
    estimatedArrival: null,
    shippingCarrier: "",
    trackingNumber: "",

    referenceNumber: "",
    noteToVendor: "",

    voidDateIsActive: false,
    voidDate: null,
    status: "Draft",

    // Totals / adjustments
    shippingAdjustment: 0,
    taxIncluded: 0,

    // PriceAugmentComponent fields
    discountPercent: 0,
    discountAmount: 0,
    discountValue: 0,
    freight: 0,
    fee: 0,
    tax: 0,
    subtotal: 0,
    total: 0,

    rows: [],
  });

  // Dropdown data
  const [vendorsList, setVendorsList] = useState([]);
  const [destinationsList, setDestinationsList] = useState([]);

  const ADD_VENDOR_VALUE = "__add_vendor__";
  const [quickVendorOpen, setQuickVendorOpen] = useState(false);

  const [paymentTermsList] = useState([
    { value: "", label: "None" },
    { value: "Cash on delivery", label: "Cash on delivery" },
    { value: "Payment on receipt", label: "Payment on receipt" },
    { value: "Payment in advance", label: "Payment in advance" },
    { value: "Net 7", label: "Net 7" },
    { value: "Net 15", label: "Net 15" },
    { value: "Net 30", label: "Net 30" },
    { value: "Net 45", label: "Net 45" },
    { value: "Net 60", label: "Net 60" },
  ]);

  const [rowsBeingAdded, setRowsBeingAdded] = useState(true);
  const [tableRows, setTableRows] = useState([]);
  const [everythingDisabled, setEverythingDisabled] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    getValues,
    watch,
    reset,
    trigger,
    formState: { errors, isDirty },
  } = useForm({ defaultValues });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const warningFutureDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() + 5);
    return d;
  }, []);

  const dueDateWatch = watch("dueDate");
  const dateToShipWatch = watch("dateToShip");
  const dateVoidWatch = watch("dateVoid");

  const shipmentDateWarnings = useMemo(() => {
    const warnings = [];

    const toDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);
    const strip = (d) => {
      if (!d) return null;
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };

    const ship = strip(toDate(dateToShipWatch));
    const due = strip(toDate(dueDateWatch));
    const voidD = strip(toDate(dateVoidWatch));

    if (ship && due && due < ship) warnings.push("Due Date is earlier than Date To Ship.");
    if (voidD) {
      if (ship && voidD < ship) warnings.push("Date Void is earlier than Date To Ship.");
      if (due && voidD < due) warnings.push("Date Void is earlier than Due Date.");
    }

    const isFiveYearsOutOrMore = (d) => d && d >= warningFutureDate;
    if (isFiveYearsOutOrMore(ship) || isFiveYearsOutOrMore(due) || isFiveYearsOutOrMore(voidD)) {
      warnings.push("One or more dates are 5+ years in the future.");
    }

    return warnings;
  }, [dateToShipWatch, dueDateWatch, dateVoidWatch, warningFutureDate]);

  // -----------------------------
  // Purchase Description "Dialog" editor
  // -----------------------------
  const [purchDescEditor, setPurchDescEditor] = useState({
    open: false,
    uid: null,
    baseline: "",     // "Variant Purch. Desc." baseline
    value: "",        // current editable value
  });

  // -----------------------------
  // Confirmation dialog controller (RedirectWarning)
  // -----------------------------
  const confirmActionRef = useRef(null);

  const [redirectWarnOpen, setRedirectWarnOpen] = useState(false);
  const [redirectWarnConfig, setRedirectWarnConfig] = useState({
    title: "Confirm action",
    message: "Are you sure you want to continue?",
    stayText: "Cancel",
    leaveText: "Confirm",
    disableLeave: false,
    disableStay: false,
  });

  const openRedirectWarning = ({
    title,
    message,
    stayText = "Cancel",
    leaveText = "Confirm",
    disableLeave = false,
    disableStay = false,
    onConfirm = null,
  }) => {
    confirmActionRef.current = typeof onConfirm === "function" ? onConfirm : null;

    setRedirectWarnConfig({
      title,
      message,
      stayText,
      leaveText,
      disableLeave,
      disableStay,
    });

    setRedirectWarnOpen(true);
  };

  const closeRedirectWarning = () => {
    setRedirectWarnOpen(false);
    confirmActionRef.current = null;
  };

  const handleConfirmAction = () => {
    const fn = confirmActionRef.current;
    closeRedirectWarning();
    fn?.();
  };

  const openPurchDescEditor = (row) => {
    const uid = row?.uid ?? null;

    // Baseline to reset to:
    // - prefer a dedicated baseline if you have it (recommended)
    // - fallback to current value at open time
    const baseline =
      String(row?.variantDescriptionPurchaseBaseline ?? row?.variantDescriptionPurchase ?? "").trim();

    const current = String(row?.variantDescriptionPurchase ?? "").trim();

    setPurchDescEditor({
      open: true,
      uid,
      baseline,
      value: current,
    });
  };

  const closePurchDescEditor = () => {
    setPurchDescEditor((prev) => ({
      ...prev,
      open: false,
      uid: null,
      baseline: "",
      value: "",
    }));
  };

  const savePurchDescEditor = () => {
    const uid = purchDescEditor.uid;
    if (!uid) {
      closePurchDescEditor();
      return;
    }

    const nextValue = String(purchDescEditor.value ?? "").trim();

    setTableRows((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const idx = next.findIndex((r) => Number(r?.uid) === Number(uid));
      if (idx === -1) return prev;

      next[idx] = {
        ...next[idx],
        variantDescriptionPurchase: nextValue,
      };

      return next;
    });

    clearErrors("rows");

    closePurchDescEditor();
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const roundTo = (n, places = 4) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const p = 10 ** places;
    return Math.round(x * p) / p;
  };

  const extractInt = (value) => {
    if (value === null || value === undefined) return NaN;
    const str = String(value).trim();
    if (!str) return NaN;
    const cleaned = str.replace(/[^0-9]/g, "");
    return cleaned ? Number(cleaned) : NaN;
  };

  const extractDecimal = (value) => {
    if (value === null || value === undefined) return NaN;
    const str = String(value).trim();
    if (!str) return NaN;

    let cleaned = str.replace(/[^0-9.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
    }
    return cleaned ? Number(cleaned) : NaN;
  };

  const clampIntFromInput = (value, { min = 0, max = Infinity, fallback = 0 } = {}) => {
    const n = extractInt(value);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
  };

  const clampDecimalFromInput = (value, { min = 0, max = Infinity, fallback = 0, places = 4 } = {}) => {
    const n = extractDecimal(value);
    if (!Number.isFinite(n)) return fallback;
    return roundTo(clamp(n, min, max), places);
  };

  const clampText = (v, maxLen) => {
    const s = String(v ?? "");
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  };

  const validateCreatePO = (formData) => {
    const headerIssues = [];
    const rowIssues = [];

    const vendorPk = String(formData?.vendorPk ?? "").trim();
    const destinationPk = String(formData?.destinationPk ?? "").trim();
    const poNumber = String(formData?.poNumber ?? "").trim();

    // -----------------------------
    // Header requirements
    // -----------------------------
    if (!vendorPk) {
      headerIssues.push("Vendor is required.");
      setError("vendorPk", { type: "manual", message: "Vendor is required." });
    }

    if (!destinationPk) {
      headerIssues.push("Destination is required.");
      setError("destinationPk", { type: "manual", message: "Destination is required." });
    }

    if (!poNumber) {
      headerIssues.push("PO Number is required.");
      setError("poNumber", { type: "manual", message: "PO Number is required." });
    }

    // -----------------------------
    // Date requirements (Create PO only)
    // -----------------------------
    const toDate = (v) => (v instanceof Date && !isNaN(v) ? v : v ? new Date(v) : null);
    const strip = (d) => {
      if (!d || Number.isNaN(d.getTime())) return null;
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };

    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);

    const due = strip(toDate(formData?.dueDate));
    const ship = strip(toDate(formData?.dateToShip));
    const voidD = strip(toDate(formData?.dateVoid));

    if (due && due < todayLocal) {
      headerIssues.push("Due Date must be today or later.");
      setError("dueDate", { type: "manual", message: "Due Date must be today or later." });
    }

    if (ship && ship < todayLocal) {
      headerIssues.push("Date To Ship must be today or later.");
      setError("dateToShip", { type: "manual", message: "Date To Ship must be today or later." });
    }

    if (voidD && voidD < todayLocal) {
      headerIssues.push("Date Void must be today or later.");
      setError("dateVoid", { type: "manual", message: "Date Void must be today or later." });
    }

    // -----------------------------
    // Rows (allow empty; only validate if any exist)
    // -----------------------------
    const rows = Array.isArray(tableRows) ? tableRows : [];

    if (rows.length > 0) {
      rows.forEach((r) => {
        const uid = r?.uid ?? "?";

        const desc = String(r?.variantDescriptionPurchase ?? "").trim();
        if (!desc) rowIssues.push(`Row ${uid}: Purchase Description is required.`);

        const qty = clampIntFromInput(r?.qtyOrdered, { min: 1, max: PG_INT_MAX, fallback: NaN });
        if (!Number.isFinite(qty) || qty < 1) rowIssues.push(`Row ${uid}: Qty Ordered must be at least 1.`);

        const cost = clampDecimalFromInput(r?.cost, { min: 0, max: PG_FLOAT4_MAX, fallback: NaN, places: 4 });
        if (!Number.isFinite(cost) || cost < 0) rowIssues.push(`Row ${uid}: Cost must be 0 or greater.`);
      });
    }

    const uniqueRowIssues = [...new Set(rowIssues)];

    // ✅ rows field error = rows only
    if (uniqueRowIssues.length) {
      setError("rows", {
        type: "manual",
        message: `Fix the following rows before creating a PO:\n• ${uniqueRowIssues.slice(0, 8).join("\n• ")}${
          uniqueRowIssues.length > 8 ? `\n• (+${uniqueRowIssues.length - 8} more)` : ""
        }`,
      });
    } else {
      clearErrors("rows");
    }

    // Any issues => fail (dialog can show both)
    const allIssues = [...headerIssues, ...uniqueRowIssues];

    if (allIssues.length) {
      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: (
          <>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>
              Cannot create PO. Fix:
            </Typography>

            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {allIssues.slice(0, 8).map((msg, i) => (
                <li key={i}>
                  <Typography variant="body2">{msg}</Typography>
                </li>
              ))}

              {allIssues.length > 8 && (
                <li>
                  <Typography variant="body2">
                    (+{allIssues.length - 8} more)
                  </Typography>
                </li>
              )}
            </Box>
          </>
        ),
      }));

      return false;
    }

    return true;
  };

  // -----------------------------
  // Initial data fetch
  // -----------------------------
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setFinalizationController((prev) => ({
          ...prev,
          visible: true,
          disableFields: true, // no pageType — disable while loading
          loading: true,
          severity: "info",
          finalResultText: "",
        }));

        reset(defaultValues);
        setTableRows([]);

        // 1) Lists for dropdowns (+ optional suggested PO number)
        const listsRes = await axios.get("http://localhost:4000/purchase-order/data-for-new");

        const nextVendors = listsRes.data?.vendorsList || [];
        const nextDestinations = listsRes.data?.warehousesList || [];

        setVendorsList(nextVendors);
        setDestinationsList(nextDestinations);

        // Prefill PO Number if backend provides one
        const suggested = listsRes.data?.generatedPoNumber ?? "";
        setValue("poNumber", suggested, { shouldDirty: false, shouldValidate: true });

        setRowsBeingAdded(false);
        setFinalizationController((prev) => ({
          ...prev,
          visible: false,
          disableFields: false,
          loading: false,
        }));
        return;
      } catch (error) {
        setRowsBeingAdded(false);
        setFinalizationController({
          visible: true,
          disableFields: true,
          loading: false,
          severity: "error",
          finalResultText: `${error.message}`,
        });
      }
    };

    fetchInitialData();
  }, [reset]);

  // //Navbar Actions
  // useEffect(() => {
  //   const isAddPage = pageType === "Add";
  //   const isEditPage = pageType === "Edit";

  //   setNavbarActions(
  //     isMobile ? (
  //       <Box
  //         sx={{
  //           display: "flex",
  //           justifyContent: "center",
  //           gap: 1,
  //           px: 0.5,
  //           py: 0.5,
  //           border: "1px solid",
  //           borderColor: "divider",
  //           borderRadius: 2,
  //           animation: shake ? "shake 0.5s" : "none",
  //           "@keyframes shake": {
  //             "0%, 100%": { transform: "translateX(0)" },
  //             "20%": { transform: "translateX(-4px)" },
  //             "40%": { transform: "translateX(4px)" },
  //             "60%": { transform: "translateX(-4px)" },
  //             "80%": { transform: "translateX(4px)" },
  //           },
  //         }}
  //       >
  //         <Button
  //           variant="outlined"
  //           color="inherit"
  //           onClick={() => navigate("/purchase-orders")}
  //           fullWidth
  //           type="button"
  //         >
  //           Cancel
  //         </Button>

  //         {isAddPage && (
  //           <Button
  //             variant="contained"
  //             color="primary"
  //             fullWidth
  //             disabled={finalizationController.disableFields}
  //             onClick={saveDraft}
  //             type="button"
  //           >
  //             Save Draft
  //           </Button>
  //         )}

  //         {isEditPage && (
  //           isDraftPo ? (
  //             <Button
  //               variant="contained"
  //               color="primary"
  //               fullWidth
  //               disabled={finalizationController.disableFields}
  //               onClick={openSaveMenu}
  //               type="button"
  //               startIcon={<MoreVertIcon/>}
  //             >
  //               Save
  //             </Button>
  //           ) : (
  //             <Button
  //               variant="contained"
  //               color="primary"
  //               fullWidth
  //               disabled={finalizationController.disableFields}
  //               onClick={updateOfficialPo}
  //               type="button"
  //             >
  //               Save
  //             </Button>
  //           )
  //         )}

  //         {!isAddPage && !isEditPage && (
  //           <Button
  //             variant="contained"
  //             color="primary"
  //             fullWidth
  //             disabled={finalizationController.disableFields}
  //             onClick={updateDraft}
  //             type="button"
  //             startIcon={<MoreVertIcon/>}
  //           >
  //             Save
  //           </Button>
  //         )}
  //       </Box>
  //     ) : (
  //       <Alert
  //         severity="info"
  //         sx={{
  //           display: "flex",
  //           alignItems: "center",
  //           animation: shake ? "shake 0.5s" : "none",
  //           "@keyframes shake": {
  //             "0%, 100%": { transform: "translateX(0)" },
  //             "20%": { transform: "translateX(-4px)" },
  //             "40%": { transform: "translateX(4px)" },
  //             "60%": { transform: "translateX(-4px)" },
  //             "80%": { transform: "translateX(4px)" },
  //           },
  //         }}
  //       >
  //         <span>Save your changes here: </span>

  //         <Button
  //           variant="outlined"
  //           color="inherit"
  //           onClick={() => navigate("/purchase-orders")}
  //           style={{ marginRight: "10px" }}
  //           type="button"
  //         >
  //           Cancel
  //         </Button>

  //         {isAddPage && (
  //           <Button
  //             variant="contained"
  //             color="primary"
  //             onClick={saveDraft}
  //             disabled={finalizationController.disableFields}
  //             type="button"
  //           >
  //             Save Draft
  //           </Button>
  //         )}

  //         {isEditPage && (
  //           isDraftPo ? (
  //             <Button
  //               variant="contained"
  //               color="primary"
  //               onClick={openSaveMenu}
  //               disabled={finalizationController.disableFields}
  //               type="button"
  //               startIcon={<MoreVertIcon/>}
  //             >
  //               Save
  //             </Button>
  //           ) : (
  //             <Button
  //               variant="contained"
  //               color="primary"
  //               onClick={updateOfficialPo}
  //               disabled={finalizationController.disableFields}
  //               type="button"
  //             >
  //               Save
  //             </Button>
  //           )
  //         )}

  //         {!isAddPage && !isEditPage && (
  //           <Button
  //             variant="contained"
  //             color="primary"
  //             onClick={updateDraft}
  //             disabled={finalizationController.disableFields}
  //             type="button"
  //             startIcon={<MoreVertIcon/>}
  //           >
  //             Save
  //           </Button>
  //         )}
  //       </Alert>
  //     )
  //   );

  //   return () => setNavbarActions(null);
  // }, [
  //   setNavbarActions,
  //   pageType,
  //   navigate,
  //   isMobile,
  //   shake,
  //   finalizationController.disableFields,
  //   everythingDisabled,
  //   tableRows
  // ]);

  // -----------------------------
  // UI helpers (unchanged)
  // -----------------------------
  const handleUidAssign = (array) => {
    return array.map((r, i) => ({
      ...r,
      uid: i + 1,
      qtyOrdered: clampIntFromInput(r.qtyOrdered, { min: 1, max: PG_INT_MAX, fallback: 1 }),
      qtyReceived: clampIntFromInput(r.qtyReceived, { min: 0, max: PG_INT_MAX, fallback: 0 }),
    }));
  };

  const getItemDetails = async (selectedVariants) => {
    try {
      const destinationPk = String(watch("destinationPk") || "").trim();

      const response = await axios.get("http://localhost:4000/purchase-order/get/item-data", {
        params: {
          selectedPks: selectedVariants.map((s) => s.variantPk),
          companyPk: companyData,
          destinationPk: destinationPk || null,
        },
      });

      const items = (response.data.items || []).map((r) => ({
        ...r,

        // Ensure numeric defaults
        qtyOnHand: Number(r.qtyOnHand || 0),
        qtyOnOrder: Number(r.qtyOnOrder || 0),

        // baseline from the variant’s current purchase description at time of adding
        variantDescriptionPurchaseBaseline: String(r?.variantDescriptionPurchase ?? "").trim(),
      }));

      const updatedRows = handleUidAssign([...tableRows, ...items]);
      setTableRows(updatedRows);
    } catch (error) {
      console.error(`Error fetching selected variants to add to purchase order:\n\n${error.message}`);
      throw error;
    }
  };

  const processRowUpdate = (newRow) => {
    const { uid } = newRow;

    const qty = clampIntFromInput(newRow.qtyOrdered, { min: 1, max: PG_INT_MAX, fallback: 1 });

    const cost = clampDecimalFromInput(newRow.cost, {
      min: 0,
      max: PG_FLOAT4_MAX,
      fallback: 0,
      places: 4,
    });

    const tax = clampDecimalFromInput(newRow.variantTax, { min: 0, max: 100, fallback: 0, places: 4 });

    const base = cost * qty;
    const taxed = base * (1 + tax / 100);

    const updatedRow = {
      ...newRow,
      qtyOrdered: qty,
      cost,
      variantTax: tax,
      costExtended: parseFloat(taxed.toFixed(4)),
    };

    const idx = Number(uid) - 1;
    const next = [...tableRows];
    if (idx >= 0 && idx < next.length) next[idx] = updatedRow;

    setTableRows(next);
    return updatedRow;
  };

  const handleDeleteClick = (uid) => {
    setTableRows((prev) => {
      const updatedRows = [...prev];
      updatedRows.splice(uid - 1, 1);
      return handleUidAssign(updatedRows);
    });
  };

  const LEFT = { align: "left", headerAlign: "left" };

  const tryNavigateWithWarning = (e, href) => {
    if (!href) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    e.preventDefault();
    e.stopPropagation();

    if (isDirty) {
      openRedirectWarning({
        title: "Leave this purchase order?",
        message:
          "You have unsaved changes. If you continue, your changes on this purchase order will be lost.",
        stayText: "Stay",
        leaveText: "Leave page",
        onConfirm: () => navigate(href),
      });
      return;
    }

    navigate(href);
  };

  const apiRef = useGridApiRef();

  const EditableDisplayCell = ({ params }) => {
    const canEdit = params.api.isCellEditable(params);

    return (
      <Box sx={{ display: "flex", alignItems: "center", height: "100%", width: "100%", minWidth: 0 }}>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
          }}
        >
          {params.formattedValue ?? params.value ?? ""}
        </Box>

        {canEdit && isMobile && (
          <IconButton
            size="small"
            aria-label="Edit"
            onClick={(e) => {
              e.stopPropagation();
              params.api.startCellEditMode({ id: params.id, field: params.field });
            }}
            sx={{ ml: 1, p: 0.25, alignSelf: "center" }}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    );
  };

  const EditableInputCellWithSave = ({ params, inputProps }) => {
    return (
      <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
        <Box sx={{ flex: 1 }}>
          <GridEditInputCell {...params} inputProps={inputProps} />
        </Box>

        <IconButton
          size="small"
          aria-label="Save"
          onClick={(e) => {
            e.stopPropagation();
            params.api.stopCellEditMode({ id: params.id, field: params.field });
          }}
          sx={{ ml: 1 }}
        >
          <SaveOutlinedIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  };

  const DigitsOnlyEditCell = (params) => {
    return (
      <GridEditInputCell
        {...params}
        inputProps={{
          inputMode: "numeric",
          pattern: "[0-9]*",
          maxLength: 10,
          onKeyDown: (e) => {
            const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End", "Tab", "Enter"];
            if (allowed.includes(e.key)) return;
            if (!/^[0-9]$/.test(e.key)) e.preventDefault();
          },
          onPaste: (e) => {
            const text = e.clipboardData.getData("text");
            if (!/^\d+$/.test(text)) e.preventDefault();
          },
          onBlur: (e) => {
            const clamped = clampIntFromInput(e.target.value, { min: 1, max: PG_INT_MAX, fallback: 1 });
            params.api.setEditCellValue({ id: params.id, field: params.field, value: clamped }, e);
          },
        }}
      />
    );
  };

  const withMobileIcons = (col, { inputProps } = {}) => ({
    ...col,
    renderCell: (params) => <EditableDisplayCell params={params} />,
    renderEditCell: (params) => <EditableInputCellWithSave params={params} inputProps={inputProps} />,
  });

  const variantTaxCol = {
    ...LEFT,
    field: "variantTax",
    headerName: "Tax",
    width: 120,
    editable: (params) => Number(params.row?.qtyReceived || 0) === 0,
    valueGetter: (value) => Number(value ?? 0),
    valueFormatter: (value) => `${Number(value ?? 0)}%`,
    renderCell: (params) => <EditableDisplayCell params={params} />,
    renderEditCell: (params) => (
      <EditableInputCellWithSave
        params={params}
        inputProps={{
          inputMode: "numeric",
          pattern: "[0-9]*",
          onWheel: (e) => e.currentTarget.blur(),
          onBlur: (e) => {
            const clamped = clampDecimalFromInput(e.target.value, { min: 0, max: 100, fallback: 0, places: 4 });
            params.api.setEditCellValue({ id: params.id, field: params.field, value: clamped }, e);
          },
        }}
      />
    ),
  };

  const baseColumns = [
    {
      ...LEFT,
      field: "headerImage",
      headerName: "Image",
      width: 60,
      renderCell: (params) => (
        <img src={params.value} alt="" style={{ width: 42, height: 42, borderRadius: 6, marginTop: "5px" }} />
      ),
      sortable: false,
      filterable: false,
    },
    {
      ...LEFT,
      field: "variantTitle",
      headerName: "Title",
      width: 280,
      renderCell: (params) => {
        const variantTitle = params.value || "—";
        const productTitle = params.row?.productTitle || "";
        const productPk = params.row?.productPk;
        const variantPk = params.row?.variantPk;

        const href =
          productPk &&
          variantPk &&
          !params.row?.productDeleted &&
          !params.row?.variantDeleted
            ? `/products/${productPk}/variant/${variantPk}`
            : null;

        const showVariantChip =
          !!variantTitle &&
          variantTitle !== "—" &&
          String(variantTitle).toLowerCase() !== "default title" &&
          variantTitle !== productTitle;

        if (showVariantChip) {
          return (
            <Box
              component="a"
              href={href}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                overflow: "hidden",
                "&:hover": { textDecoration: "underline" },
              }}
              onClick={(e) => {
                if (href && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  tryNavigateWithWarning(e, href);
                }
              }}
            >
              <Typography variant="body2" noWrap sx={{ fontWeight: 700, color: "primary.main" }}>
                {productTitle || variantTitle}
              </Typography>

              <Chip
                size="small"
                label={variantTitle}
                sx={{
                  mt: 0.5,
                  alignSelf: "flex-start",
                  "& .MuiChip-label": {
                    display: "inline-block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "0.75rem",
                    color: "text.secondary",
                    px: 0.75,
                  },
                }}
              />
            </Box>
          );
        }

        return (
          <Box sx={{ display: "flex", alignItems: "center", height: "100%", minWidth: 0 }}>
            <Box
              component="a"
              href={href}
              sx={{
                cursor: href ? "pointer" : "default",
                color: href ? "primary.main" : "text.primary",
                fontWeight: 600,
                textDecoration: "none",
                "&:hover": { textDecoration: href ? "underline" : "none" },
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={(e) => {
                if (href && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  tryNavigateWithWarning(e, href);
                }
              }}
            >
              {productTitle || variantTitle || "—"}
            </Box>
          </Box>
        );
      },
    },

    { ...LEFT, field: "variantSku", headerName: "SKU", width: 160 },

    {
      ...LEFT,
      field: "variantDescriptionPurchase",
      headerName: "Purchase Description",
      width: 260,
      editable: (params) => Number(params.row?.qtyReceived || 0) === 0,
      renderCell: (params) => (
        <Box
          sx={{
            width: "100%",
            cursor: Number(params.row?.qtyReceived || 0) === 0 ? "pointer" : "default",
          }}
          onClick={(e) => {
            // single click opens editor (optional)
            if (Number(params.row?.qtyReceived || 0) !== 0) return;
            e.stopPropagation();
            openPurchDescEditor(params.row);
          }}
        >
          <EditableDisplayCell params={params} />
        </Box>
      ),
    },

    {
      ...LEFT,
      field: "qtyOrdered",
      headerName: "Qty Ordered",
      width: 120,
      editable: (params) => Number(params.row?.qtyReceived || 0) === 0,
      renderCell: (params) => <EditableDisplayCell params={params} />,
      renderEditCell: (params) => (
        <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
          <Box sx={{ flex: 1 }}>{DigitsOnlyEditCell(params)}</Box>

          <IconButton
            size="small"
            aria-label="Save"
            onClick={(e) => {
              e.stopPropagation();
              params.api.stopCellEditMode({ id: params.id, field: params.field });
            }}
            sx={{ ml: 1 }}
          >
            <SaveOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    },
    {
      ...LEFT,
      field: "qtyOnHand",
      headerName: "Qty On Hand",
      width: 120,
      valueGetter: (v) => Number(v ?? 0),
    },
    {
      ...LEFT,
      field: "qtyOnOrder",
      headerName: "Qty On Order",
      width: 120,
      valueGetter: (v) => Number(v ?? 0),
    },

    withMobileIcons(
      {
        ...LEFT,
        field: "cost",
        headerName: "Cost",
        width: 120,
        valueGetter: (v) => Number(v ?? 0),
        valueFormatter: (v) => `$${formatMoney(v ?? 0, 2)}`,
        editable: (params) => Number(params.row?.qtyReceived || 0) === 0,
      },
      {
        inputProps: {
          inputMode: "decimal",
          maxLength: 24,
          onBlur: (e) => {
            const clamped = clampDecimalFromInput(e.target.value, {
              min: 0,
              max: PG_FLOAT4_MAX,
              fallback: 0,
              places: 4,
            });
            e.target.value = String(clamped);
          },
        },
      }
    ),

    variantTaxCol,

    {
      ...LEFT,
      field: "costExtended",
      headerName: "Extended Cost",
      width: 140,
      valueGetter: (v) => Number(v ?? 0),
      valueFormatter: (v) => `$${formatMoney(v ?? 0, 2)}`,
    },
  ];

  const editableDataGrid = useMemo(() => {
    const actionsCol = {
      ...LEFT,
      headerName: "",
      field: "actions",
      type: "actions",
      width: 25,
      getActions: (params) => {
        try {
          if (tableRows.length === 0) return [];
          
          return [
            <GridActionsCellItem
              key="delete-action"
              icon={<DeleteIcon />}
              onClick={() => handleDeleteClick(params.row.uid)}
              label="Delete"
              color="inherit"
            />,
          ];
        } catch (error) {
          return [];
        }
      },
    };

    return [actionsCol, ...baseColumns];
  }, [baseColumns, tableRows, finalizationController]);

  //Prevents form submission from pressing enter button.
  const handlePressEnter = (event) => {
    if (event.key === "Enter") event.preventDefault();
  };

  const sectionBorder = darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  // -----------------------------
  // Totals / Summary (RESTORED)
  // -----------------------------
  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const formatMoney = (value, decimals = 4) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return (0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const tableSubtotal = useMemo(() => {
    const rows = Array.isArray(tableRows) ? tableRows : [];
    const sum = rows.reduce((acc, r) => {
      // Prefer costExtended (what your grid writes), fall back to itemCostExtended if older data exists
      const line = money(r?.costExtended ?? r?.itemCostExtended ?? 0);
      return acc + line;
    }, 0);

    return roundTo(sum, 4);
  }, [tableRows]);

  const summaryCalc = useMemo(() => {
    const discountPercent = money(watch("discountPercent"));
    const discountAmount = money(watch("discountAmount"));
    const freight = money(watch("freight"));
    const fee = money(watch("fee"));
    const tax = money(watch("tax"));

    const percentDiscountValue = roundTo(tableSubtotal * (discountPercent / 100), 4);

    // Discounts reduce total, others increase
    const netAdditional = roundTo(
      -percentDiscountValue - discountAmount + freight + fee + tax,
      4
    );

    const tableTotal = roundTo(tableSubtotal + netAdditional, 4);

    return {
      discountPercent,
      discountAmount,
      freight,
      fee,
      tax,
      percentDiscountValue,
      netAdditional,
      tableTotal,
    };
  }, [
    tableSubtotal,
    watch("discountPercent"),
    watch("discountAmount"),
    watch("freight"),
    watch("fee"),
    watch("tax"),
  ]);

  return (
    <Box className="page-responsive-width" sx={{ display: "flex", flexDirection: "column" }}>
      <LoadingAndFinalizationAlert
        visible={finalizationController.visible}
        loading={finalizationController.loading}
        severity={finalizationController.severity}
        finalResultText={finalizationController.finalResultText}
      />

      <form id="poForm" noValidate autoComplete="off" onKeyDown={handlePressEnter}>
        <Box
          sx={{
            "& > *": {
              backgroundColor: darkMode ? "#1e1e1e" : "#fff",
              borderRadius: 2,
              padding: 2,
              border: "1px solid",
              borderColor: sectionBorder,
            },
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <Box>
            <Typography variant="subtitle1">Po Number & Dates</Typography>

            {/* PO Number */}
            <Box
              sx={{
                mt: 1,
                border: "1px solid",
                borderColor: sectionBorder,
                borderRadius: 2,
                p: 2,
                backgroundColor: darkMode ? "#1e1e1e" : "#fff",
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                PO Number
              </Typography>

              <Controller
                name="poNumber"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="PO Number"
                    variant="outlined"
                    disabled={finalizationController.disableFields}
                    value={field.value ?? ""}
                    error={!!errors.poNumber}
                    helperText={errors.poNumber?.message || ""}
                    onChange={(e) => {
                      if (errors.poNumber) clearErrors("poNumber");
                      field.onChange(e.target.value);
                    }}
                  />
                )}
              />
            </Box>

            {/* Shipment Dates */}
            <Box
              sx={{
                mt: 2,
                border: "1px solid",
                borderColor: sectionBorder,
                borderRadius: 2,
                p: 2,
                backgroundColor: darkMode ? "#1e1e1e" : "#fff",
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                Shipment Dates
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Controller
                    name="dueDate"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Due Date"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                        />
                      </LocalizationProvider>
                    )}
                  />
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
                  <Controller
                    name="dateToShip"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Date To Ship"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                        />
                      </LocalizationProvider>
                    )}
                  />
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
                  <Controller
                    name="dateVoid"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Date Void"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                        />
                      </LocalizationProvider>
                    )}
                  />
                </Grid>
              </Grid>

              {shipmentDateWarnings.length > 0 && (
                <Alert
                  severity="warning"
                  sx={{
                    mt: 2,
                    alignItems: "center",
                    "& .MuiAlert-icon": { alignItems: "center", padding: 0, marginRight: 1.5 },
                    "& .MuiAlert-message": { padding: 0 },
                  }}
                >
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {shipmentDateWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </Box>
                </Alert>
              )}
            </Box>
          </Box>

          {/* Vendor / Destination */}
          <Box>
            <Typography variant="subtitle1">Vendor & Destination</Typography>

            <Box
              sx={{
                mt: 1,
                border: "1px solid",
                borderColor: sectionBorder,
                borderRadius: 2,
                overflow: "hidden",
                backgroundColor: darkMode ? "#1e1e1e" : "#fff",
              }}
            >
              <Grid container>
                {/* Vendor */}
                <Grid
                  size={{ xs: 12, md: 6 }}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid",
                    borderColor: sectionBorder,
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Vendor
                  </Typography>

                  <Controller
                    name="vendorPk"
                    control={control}
                    rules={{ required: "Vendor is required" }}
                    render={({ field }) => (
                      <FormControl fullWidth error={!!errors.vendorPk}>
                        <Select
                          {...field}
                          displayEmpty
                          variant="outlined"
                          disabled={finalizationController.disableFields}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === ADD_VENDOR_VALUE) {
                              setQuickVendorOpen(true);
                              return;
                            }
                            field.onChange(e);
                          }}
                          renderValue={(value) => {
                            if (!value) return "Select vendor";
                            const v = vendorsList.find((x) => String(x.pk) === String(value));
                            return v?.name || "Select vendor";
                          }}
                        >
                          <MenuItem value="">
                            <em>Select vendor</em>
                          </MenuItem>

                          <MenuItem value={ADD_VENDOR_VALUE}>
                            <strong>+ Add Vendor</strong>
                          </MenuItem>

                          {vendorsList.map((v) => (
                            <MenuItem key={v.pk} value={v.pk}>
                              {v.name}
                            </MenuItem>
                          ))}
                        </Select>

                        {!!errors.vendorPk && (
                          <FormHelperText>{errors.vendorPk.message}</FormHelperText>
                        )}
                      </FormControl>
                    )}
                  />
                </Grid>

                {/* Destination */}
                <Grid
                  size={{ xs: 12, md: 6 }}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid",
                    borderColor: sectionBorder,
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Destination
                  </Typography>

                  <Controller
                    name="destinationPk"
                    control={control}
                    rules={{ required: "Destination is required" }}
                    render={({ field }) => (
                      <FormControl fullWidth error={!!errors.destinationPk}>
                        <Select
                          {...field}
                          displayEmpty
                          variant="outlined"
                          disabled={finalizationController.disableFields}
                          renderValue={(value) => {
                            if (!value) return "Select destination";
                            const d = destinationsList.find((x) => String(x.pk) === String(value));
                            return d?.name || "Select destination";
                          }}
                        >
                          <MenuItem value="">
                            <em>Select destination</em>
                          </MenuItem>

                          {destinationsList.map((d) => (
                            <MenuItem key={d.pk} value={d.pk}>
                              {d.name}
                            </MenuItem>
                          ))}
                        </Select>

                        {!!errors.destinationPk && (
                          <FormHelperText>{errors.destinationPk.message}</FormHelperText>
                        )}
                      </FormControl>
                    )}
                  />
                </Grid>

                {/* Payment terms */}
                <Grid size={{ xs: 12, md: 6 }} sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Payment terms
                  </Typography>

                  <Controller
                    name="paymentTerms"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <Select
                          {...field}
                          displayEmpty
                          disabled={finalizationController.disableFields}
                          renderValue={(value) => {
                            const found = paymentTermsList.find(
                              (x) => String(x.value) === String(value)
                            );
                            return found?.label || "None";
                          }}
                          sx={{ "& .MuiSelect-select": { py: 1.25 } }}
                        >
                          {paymentTermsList.map((pt) => (
                            <MenuItem key={pt.value} value={pt.value}>
                              {pt.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>

                {/* Vendor currency */}
                <Grid size={{ xs: 12, md: 6 }} sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Vendor currency
                  </Typography>

                  <Controller
                    name="vendorCurrency"
                    control={control}
                    rules={{ required: "Currency is required" }}
                    render={({ field }) => {
                      const selected =
                        WORLD_CURRENCIES.find((c) => c.value === field.value) || null;

                      return (
                        <FormControl fullWidth error={!!errors.vendorCurrency}>
                          <Autocomplete
                            options={WORLD_CURRENCIES}
                            value={selected}
                            onChange={(_, option) => field.onChange(option?.value || "")}
                            disabled={finalizationController.disableFields}
                            getOptionLabel={(option) =>
                              option?.label ? `${option.label} (${option.value})` : ""
                            }
                            isOptionEqualToValue={(option, value) =>
                              option.value === value.value
                            }
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                variant="outlined"
                                placeholder="Select currency"
                                error={!!errors.vendorCurrency}
                                helperText={errors.vendorCurrency?.message}
                              />
                            )}
                          />
                        </FormControl>
                      );
                    }}
                  />
                </Grid>
              </Grid>
            </Box>
          </Box>

          {/* Shipment details */}
          <Box>
            <Typography variant="subtitle1">Shipment details</Typography>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="shippingCarrier"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <TextField
                        {...field}
                        label="Shipping carrier"
                        disabled={finalizationController.disableFields}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(clampText(e.target.value, MAX_SHIPPING_CARRIER))
                        }
                        inputProps={{ maxLength: MAX_SHIPPING_CARRIER }}
                      />
                    </FormControl>
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="trackingNumber"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Tracking number"
                      disabled={finalizationController.disableFields}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(clampText(e.target.value, MAX_TRACKING))}
                      inputProps={{ maxLength: MAX_TRACKING }}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </Box>

          {/* Add products */}
          <Box>
            <Typography variant="subtitle1">Add products</Typography>
            
            <ProductBrowser
              darkMode={darkMode}
              disabled={finalizationController.disableFields}
              onAddSelected={(selectedProducts) => getItemDetails(selectedProducts)}
            />

            <Box
              sx={{
                mt: 2,
                width: "calc(100% - 1px)", //We need to use calc() in order to get a set wiedth in pixels for the DataGrid.
                bgcolor: darkMode ? "#1e1e1e" : "#fff",
                borderRadius: 2,
                border: "1px solid",
                borderColor: !!errors.rows ? "error.main" : sectionBorder,
                height: "700px",
                overflow: "auto",
              }}
            >
              <DataGrid
                apiRef={apiRef}
                rows={tableRows}
                columns={editableDataGrid}
                loading={rowsBeingAdded}
                disableRowSelectionOnClick
                getRowId={(row) => row.uid}
                editMode="cell"
                processRowUpdate={processRowUpdate}
                onCellEditStart={(params, event) => {
                  if (params.field !== "variantDescriptionPurchase") return;

                  // prevent the grid from entering edit mode
                  event.defaultMuiPrevented = true;

                  // only open if the row is actually editable by your rule
                  if (Number(params.row?.qtyReceived || 0) !== 0) return;

                  openPurchDescEditor(params.row);
                }}
                localeText={{ noRowsLabel: "Ordered products will appear here." }}
                isCellEditable={() => !finalizationController.disableFields}
                sx={{
                  border: "none",
                  "& .MuiDataGrid-cell--editable": {
                    backgroundColor: darkMode
                      ? "rgba(255, 255, 255, 0.12)"
                      : "rgba(0, 0, 0, 0.04)",
                    fontWeight: 600,
                  },
                }}
              />
            </Box>

            {!!errors.rows && (
              <FormHelperText error sx={{ px: 2, py: 1 }}>
                {errors.rows.message}
              </FormHelperText>
            )}
          </Box>

          <Dialog open={purchDescEditor.open} onClose={closePurchDescEditor} fullWidth maxWidth="md">
            <DialogTitle sx={{ fontWeight: 800 }}>Edit Purchase Description</DialogTitle>

            <DialogContent dividers>
              <TextField
                fullWidth
                multiline
                minRows={6}
                label="Purchase Description"
                value={purchDescEditor.value}
                onChange={(e) =>
                  setPurchDescEditor((prev) => ({
                    ...prev,
                    value: e.target.value,
                  }))
                }
              />
            </DialogContent>

            <DialogActions sx={{ gap: 1, flexWrap: "wrap", px: 3, py: 2 }}>
              <Button
                variant="outlined"
                onClick={() =>
                  setPurchDescEditor((prev) => ({
                    ...prev,
                    value: prev.baseline,
                  }))
                }
              >
                Reset to Variant Purch. Desc.
              </Button>

              <Button variant="outlined" color="inherit" onClick={closePurchDescEditor}>
                Cancel
              </Button>

              <Button variant="contained" onClick={savePurchDescEditor}>
                Save
              </Button>
            </DialogActions>
          </Dialog>

          {/* Price Augments */}
          <Box>
            <Typography variant="subtitle1">Additional Expenses</Typography>
            <PriceAugmentComponent
              control={control}
              setValue={setValue}
              getValues={getValues}
              trigger={trigger}
              watch={watch}
              rowsToMonitor={tableRows}
              paramToMonitor="costExtended"
              everythingDisabled={finalizationController.disableFields}
              isMobile={isMobile}
              defaultValues={{
                discountPercent: defaultValues.discountPercent,
                discountAmount: defaultValues.discountAmount,
                freight: defaultValues.freight,
                fee: defaultValues.fee,
              }}
              hideFields={[]}
            />
          </Box>

          {/* Bottom row: Additional details + Cost summary */}
          <Box>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Box
                  sx={{
                    backgroundColor: darkMode ? "#1e1e1e" : "#fff",
                    borderRadius: 2,
                    padding: 2,
                    border: "1px solid",
                    borderColor: sectionBorder,
                    height: "100%",
                  }}
                >
                  <Typography variant="subtitle1">Additional details</Typography>

                  <Controller
                    name="referenceNumber"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        fullWidth
                        label="Reference number"
                        sx={{ mb: 2 }}
                        disabled={finalizationController.disableFields}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(clampText(e.target.value, MAX_REFERENCE))}
                        inputProps={{ maxLength: MAX_REFERENCE }}
                        
                      />
                    )}
                  />

                  <Controller
                    name="noteToVendor"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        fullWidth
                        multiline
                        rows={3}
                        label="Note to vendor"
                        disabled={finalizationController.disableFields}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(clampText(e.target.value, MAX_VENDOR_NOTE))}
                        inputProps={{ maxLength: MAX_VENDOR_NOTE }}
                        
                      />
                    )}
                  />
                </Box>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Box
                  sx={{
                    backgroundColor: darkMode ? "#1e1e1e" : "#fff",
                    borderRadius: 2,
                    padding: 2,
                    border: "1px solid",
                    borderColor: sectionBorder,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>Subtotal</Typography>

                    <Box sx={{ mt: 1, display: "flex", justifyContent: "space-between" }}>
                      <Typography sx={{ fontWeight: 700 }}>Subtotal</Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        ${formatMoney(tableSubtotal || 0, 2)}
                      </Typography>
                    </Box>

                    <Typography sx={{ mt: 0.5 }} color="text.secondary">
                      {(Array.isArray(tableRows) ? tableRows.length : 0)} items
                    </Typography>
                  </Box>

                  {/* --- Middle: Additional Expenses --- */}
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>Additional Expenses</Typography>

                    {(() => {
                      const {
                        discountPercent,
                        discountAmount,
                        freight,
                        fee,
                        tax,
                        percentDiscountValue,
                        netAdditional,
                      } = summaryCalc;

                      const line = (label, value, isDiscount = false) => (
                        <Box
                          key={label}
                          sx={{ mt: 0.75, display: "flex", justifyContent: "space-between" }}
                        >
                          <Typography color="text.secondary">{label}</Typography>
                          <Typography color="text.primary">
                            {isDiscount ? "-" : "+"}${formatMoney(value || 0, 2)}
                          </Typography>
                        </Box>
                      );

                      return (
                        <Box sx={{ mt: 1 }}>
                          {/* Net */}
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography sx={{ fontWeight: 700 }}>Net additional</Typography>
                            <Typography sx={{ fontWeight: 700 }}>
                              {(netAdditional < 0 ? "-" : "+")}${formatMoney(Math.abs(netAdditional), 2)}
                            </Typography>
                          </Box>

                          {/* Breakdown */}
                          {discountPercent > 0 &&
                            line(`Discount (${discountPercent}%)`, percentDiscountValue, true)}
                          {discountAmount > 0 && line("Discount ($)", discountAmount, true)}
                          {freight > 0 && line("Freight", freight)}
                          {fee > 0 && line("Fee", fee)}
                          {tax > 0 && line("Tax", tax)}
                        </Box>
                      );
                    })()}
                  </Box>

                  {/* --- Bottom: Total --- */}
                  <Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Typography sx={{ fontWeight: 800 }}>Total</Typography>
                      <Typography sx={{ fontWeight: 800 }}>
                        ${formatMoney(summaryCalc.tableTotal || 0, 2)}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Box>
      </form>

      <QuickCreateVendorComponent
        open={quickVendorOpen}
        onClose={() => setQuickVendorOpen(false)}
        disable={finalizationController.disableFields}
        onCreated={(createdVendor) => {
          setVendorsList((prev) => {
            const next = Array.isArray(prev) ? [...prev] : [];
            const exists = next.some((v) => String(v.pk) === String(createdVendor.pk));
            if (!exists) next.push(createdVendor);
            next.sort((a, b) =>
              String(a.name || "").localeCompare(String(b.name || ""), undefined, {
                sensitivity: "base",
              })
            );
            return next;
          });

          setValue("vendorPk", String(createdVendor.pk), {
            shouldDirty: true,
            shouldValidate: true,
          });
        }}
      />

      <RedirectWarning
        open={redirectWarnOpen}
        onClose={closeRedirectWarning}
        onStay={() => {}}
        onLeave={handleConfirmAction}
        title={redirectWarnConfig.title}
        message={redirectWarnConfig.message}
        stayText={redirectWarnConfig.stayText}
        leaveText={redirectWarnConfig.leaveText}
        disableLeave={redirectWarnConfig.disableLeave}
        disableStay={redirectWarnConfig.disableStay}
      />

      <FinalizationDialog
        onClose={() => setFinalDialog((prev) => ({ ...prev, open: false }))}
        open={finalDialog.open}
        loadingResultText={finalDialog.loadingText}
        severity={finalDialog.severity}
        finalResultText={finalDialog.severityText}
      />
    </Box>
  );
}

ManagePurchaseOrder.propTypes = {
  setNavbarActions: PropTypes.func,
};

export default ManagePurchaseOrder;