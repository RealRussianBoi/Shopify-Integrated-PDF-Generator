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
  InputLabel, ListItemIcon, Menu, MenuItem, Select, Snackbar,
  TextField, Typography, useMediaQuery as useMuiMediaQuery,
  useTheme as useMuiTheme, } from "@mui/material";
import CachedRoundedIcon from "@mui/icons-material/CachedRounded";
import DeleteIcon from "@mui/icons-material/Delete";
import QuestionMarkIcon from "@mui/icons-material/QuestionMark";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { DataGrid, GridActionsCellItem, useGridApiRef, GridEditInputCell, } from "@mui/x-data-grid";
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
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
const MAX_PAYMENT_TERMS = 20;                 // paymentTerms VARCHAR(20)
const MAX_PAYMENT_CURRENCY = 3;               // paymentCurrency VARCHAR(3)
const MAX_STATUS = 10;                        // status VARCHAR(10)

// Practical UI caps for "unbounded VARCHAR" fields (Postgres VARCHAR without length is unlimited)
const MAX_TRACKING = 255;
const MAX_REFERENCE = 255;

function ManagePurchaseOrder({
  pageType = "Add",
  setNavbarActions = () => {},
}) {
  const { darkMode } = useTheme();
  const { companyData } = useContext(AppContext);
  const { poPk } = useParams();
  const poListPk = Number(poPk);

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

  const [shake, setShake] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [viewOnlySnackOpen, setViewOnlySnackOpen] = useState(false);
  const [viewOnlySnackMsg, setViewOnlySnackMsg] = useState("");
  const viewOnlySnackShownRef = useRef(false);

  const [poSettings, setPoSettings] = useState({
    usePrefixSuffix: false,
    prefix: "",
    suffix: "",
  });

  const [poStatus, setPoStatus] = useState("Draft");   // "Draft" | "Open" | "On Hold" | "Closed"
  const [isDraftPo, setIsDraftPo] = useState(false);
  const normalizedStatus = String(poStatus || "").trim();
  const isCompletePo = normalizedStatus === "Complete";
  const isClosedPo = normalizedStatus === "Closed";
  const isReadOnlyStatus = isClosedPo || isCompletePo;

  // --- Save menu (Edit page) ---
  const [saveMenuAnchorEl, setSaveMenuAnchorEl] = useState(null);
  const saveMenuOpen = Boolean(saveMenuAnchorEl);

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

  //Change boolean when needed to trigger the data fetching useEffect.
  const [dataReload, triggerDataReload] = useState(false);

  // Dropdown data
  const [vendorsList, setVendorsList] = useState([]);
  const [destinationsList, setDestinationsList] = useState([]);
  const vendorsListRef = useRef([]);
  const destinationsListRef = useRef([]);

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

  // PO number mode + caching (Add page)
  const [poNumberMode, setPoNumberMode] = useState("auto");
  const [generatedPoNumber, setGeneratedPoNumber] = useState("");
  const [customPoNumber, setCustomPoNumber] = useState("");
  const [poNumberLoading, setPoNumberLoading] = useState(false);
  // --- PO number availability ---
  const [poNumberCheckLoading, setPoNumberCheckLoading] = useState(false);
  const [poNumberCheckResult, setPoNumberCheckResult] = useState(null); 

  const [rowsBeingAdded, setRowsBeingAdded] = useState(true);
  const [tableRows, setTableRows] = useState([]);
  const [removedVariantsOpen, setRemovedVariantsOpen] = useState(false);
  const [removedVariantRows, setRemovedVariantRows] = useState([]);
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

  const poNumberValue = watch("poNumber");

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
  // Helpers
  // -----------------------------
  const CUSTOM_PREFIX = "CUST-";

  const isAddPage = pageType === "Add";
  const showPoNumberControls = isAddPage || isDraftPo;
  const poNumberReadOnly = !showPoNumberControls;

  // -----------------------------
  // Purchase Description "Dialog" editor
  // -----------------------------
  const [purchDescEditor, setPurchDescEditor] = useState({
    open: false,
    uid: null,
    baseline: "",     // "Variant Purch. Desc." baseline
    value: "",        // current editable value
  });

  // --- Duplicate menu ---
  const [duplicateMenuAnchorEl, setDuplicateMenuAnchorEl] = useState(null);
  const duplicateMenuOpen = Boolean(duplicateMenuAnchorEl);

  // --- More Actions menu ---
  const [moreActionsAnchorEl, setMoreActionsAnchorEl] = useState(null);
  const moreActionsMenuOpen = Boolean(moreActionsAnchorEl);

  const openDuplicateMenu = (e) => setDuplicateMenuAnchorEl(e.currentTarget);
  const closeDuplicateMenu = () => setDuplicateMenuAnchorEl(null);

  const openMoreActionsMenu = (e) => setMoreActionsAnchorEl(e.currentTarget);
  const closeMoreActionsMenu = () => setMoreActionsAnchorEl(null);

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

  const hasAnyReceived = useMemo(() => {
    const rows = Array.isArray(tableRows) ? tableRows : [];
    return rows.some((r) => Number(r?.qtyReceived || 0) > 0);
  }, [tableRows]);

  const deletedReceivedRows = useMemo(() => {
    const rows = Array.isArray(tableRows) ? tableRows : [];
    return rows.filter((r) => !!r.deletedButReceived);
  }, [tableRows]);

  const hasAnyExtraRows = useMemo(() => {
    const rows = Array.isArray(tableRows) ? tableRows : [];
    return rows.some((r) => !!r?.isExtra);
  }, [tableRows]);

  const renderIsExtraChip = (isExtra) => {
    if (!isExtra) return null;

    return (
      <Chip
        size="small"
        label="Is Extra"
        sx={{
          fontWeight: 700,
          // keep it subtle like your other chips
          bgcolor: darkMode ? "rgba(255, 238, 88, 0.22)" : "rgba(251, 192, 45, 0.20)",
          color: "text.primary",
        }}
      />
    );
  };

  const getFullPoNumber = (rawPoNumber) => {
    const raw = String(rawPoNumber || "").trim();
    if (!raw) return "";

    // Only apply prefix/suffix when enabled (same condition you use in the field)
    const shouldShowPrefixSuffix = poSettings?.usePrefixSuffix;
    const prefix = shouldShowPrefixSuffix ? String(poSettings?.prefix || "") : "";
    const suffix = shouldShowPrefixSuffix ? String(poSettings?.suffix || "") : "";

    // Avoid double-applying if the stored/displayed value already includes them
    const alreadyHasPrefix = prefix && raw.startsWith(prefix);
    const alreadyHasSuffix = suffix && raw.endsWith(suffix);

    const withPrefix = alreadyHasPrefix ? raw : `${prefix}${raw}`;
    const withPrefixSuffix = alreadyHasSuffix ? withPrefix : `${withPrefix}${suffix}`;

    return withPrefixSuffix;
  };

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

  const applyLoadedPoNumberMode = (loadedPoNumberRaw, loadedCustomPoNumber) => {
    const raw = String(loadedPoNumberRaw || "").trim();
    const isCustom = !!loadedCustomPoNumber;

    // If backend says it was custom at time of save, force Custom mode.
    if (isCustom) {
      setPoNumberMode("custom");
      setCustomPoNumber(raw);          // raw is the user-entered/base portion now
      setGeneratedPoNumber("");
      setValue("poNumber", raw, { shouldDirty: false, shouldValidate: true });
      return;
    }

    // Otherwise -> Auto
    setPoNumberMode("auto");
    setGeneratedPoNumber(raw);
    setCustomPoNumber("");

    setValue("poNumber", raw, { shouldDirty: false, shouldValidate: true });
  };

  const renderStatusChip = (status) => {
    const s = String(status || "Open");

    // pick whatever colors you want
    const chipSxByStatus = {
      Draft:  { bgcolor: darkMode ? "rgba(144,202,249,0.25)" : "rgba(25,118,210,0.15)", color: "text.primary" },
      Open:   { bgcolor: darkMode ? "rgba(102,187,106,0.25)" : "rgba(46,125,50,0.15)", color: "text.primary" },
      "On Hold": { bgcolor: darkMode ? "rgba(255,238,88,0.25)" : "rgba(251,192,45,0.20)", color: "text.primary" },
      Closed: { bgcolor: darkMode ? "rgba(239,83,80,0.25)" : "rgba(211,47,47,0.15)", color: "text.primary" },
      Complete: { bgcolor: darkMode ? "rgba(156,39,176,0.25)" : "rgba(156,39,176,0.15)", color: "text.primary" },
    };

    return (
      <Chip
        size="small"
        label={s}
        sx={{
          ml: 1,
          fontWeight: 700,
          ...((chipSxByStatus[s] || chipSxByStatus.Open)),
        }}
      />
    );
  };

  const stripCustomPrefix = (v) => {
    const s = String(v ?? "");
    return s.startsWith(CUSTOM_PREFIX) ? s.slice(CUSTOM_PREFIX.length) : s;
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

  const validateEditPO = (formData) => {
    const headerIssues = [];
    const rowIssues = [];

    const vendorPk = String(formData?.vendorPk ?? "").trim();
    const destinationPk = String(formData?.destinationPk ?? "").trim();
    const poNumber = String(formData?.poNumber ?? "").trim();

    if (!vendorPk) headerIssues.push("Vendor is required.");
    if (!destinationPk) headerIssues.push("Destination is required.");
    if (!poNumber) headerIssues.push("PO Number is required.");

    const rows = Array.isArray(tableRows) ? tableRows : [];

    // ✅ Only validate rows if any exist
    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const desc = String(r?.variantDescriptionPurchase ?? "").trim();
        if (!desc) rowIssues.push(`Row ${i + 1}: Purchase Description is required.`);

        const qtyOrdered = clampIntFromInput(r?.qtyOrdered, { min: 1, max: PG_INT_MAX, fallback: NaN });
        if (!Number.isFinite(qtyOrdered) || qtyOrdered < 1) {
          rowIssues.push(`Row ${i + 1}: Qty Ordered must be at least 1.`);
        }

        const qtyReceived = clampIntFromInput(r?.qtyReceived, { min: 0, max: PG_INT_MAX, fallback: 0 });
        if (qtyOrdered < qtyReceived) {
          rowIssues.push(`Row ${i + 1}: Qty Ordered cannot be less than Qty Received.`);
        }

        const cost = clampDecimalFromInput(r?.cost, { min: 0, max: PG_FLOAT4_MAX, fallback: NaN, places: 4 });
        if (!Number.isFinite(cost) || cost < 0) {
          rowIssues.push(`Row ${i + 1}: Cost must be 0 or greater.`);
        }

        const variantPkNum = Number(r?.variantPk);
        const productPkNum = Number(r?.productPk);
        if (!Number.isFinite(variantPkNum) || variantPkNum <= 0) rowIssues.push(`Row ${i + 1}: variantPk is required.`);
        if (!Number.isFinite(productPkNum) || productPkNum <= 0) rowIssues.push(`Row ${i + 1}: productPk is required.`);
      }
    }

    // ✅ Field-level errors for header (optional but recommended)
    if (!vendorPk) setError("vendorPk", { type: "manual", message: "Vendor is required." });
    if (!destinationPk) setError("destinationPk", { type: "manual", message: "Destination is required." });
    if (!poNumber) setError("poNumber", { type: "manual", message: "PO Number is required." });

    // ✅ Rows error contains ONLY row-related messages
    if (rowIssues.length) {
      setError("rows", {
        type: "manual",
        message: `Fix the following rows before saving:\n• ${rowIssues.slice(0, 8).join("\n• ")}${
          rowIssues.length > 8 ? `\n• (+${rowIssues.length - 8} more)` : ""
        }`,
      });
    } else {
      clearErrors("rows");
    }

    // If anything failed, show dialog + shake (you can choose whether to include header text here)
    const hasIssues = headerIssues.length || rowIssues.length;

    if (hasIssues) {
      setShake(true);
      setTimeout(() => setShake(false), 600);

      const allForDialog = [...headerIssues, ...rowIssues];

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: (
          <>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>
              Cannot save PO. Fix:
            </Typography>

            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {allForDialog.slice(0, 8).map((msg, i) => (
                <li key={i}>
                  <Typography variant="body2">{msg}</Typography>
                </li>
              ))}

              {allForDialog.length > 8 && (
                <li>
                  <Typography variant="body2">
                    (+{allForDialog.length - 8} more)
                  </Typography>
                </li>
              )}
            </Box>
          </>
        ),
      }));

      return false;
    }

    // Clear header errors if you want (optional)
    clearErrors(["vendorPk", "destinationPk", "poNumber"]);
    return true;
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
      setShake(true);
      setTimeout(() => setShake(false), 600);

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

  const sanitizeForDb = (formData, rows) => {
    const safe = { ...formData };

    // Add page: store with prefix for custom mode only
    if (pageType === "Add" && poNumberMode === "custom") {
      safe.poNumber = safe.poNumber ? `${CUSTOM_PREFIX}${stripCustomPrefix(safe.poNumber)}` : "";
    }

    safe.shippingCarrier = clampText(safe.shippingCarrier, MAX_SHIPPING_CARRIER);
    safe.trackingNumber = clampText(safe.trackingNumber, MAX_TRACKING);
    safe.referenceNumber = clampText(safe.referenceNumber, MAX_REFERENCE);
    safe.noteToVendor = clampText(safe.noteToVendor, MAX_VENDOR_NOTE);

    safe.paymentTerms = clampText(safe.paymentTerms, MAX_PAYMENT_TERMS);
    safe.vendorCurrency = clampText(safe.vendorCurrency, MAX_PAYMENT_CURRENCY);
    safe.status = clampText(safe.status, MAX_STATUS);
    
    safe.rows = (Array.isArray(rows) ? rows : []).map((r) => ({
      ...r,
      qtyOrdered: clampIntFromInput(r.qtyOrdered, { min: 1, max: PG_INT_MAX, fallback: 1 }),
      qtyReceived: clampIntFromInput(r.qtyReceived, { min: 0, max: PG_INT_MAX, fallback: 0 }),
      cost: clampDecimalFromInput(r.cost, { min: 0, max: PG_FLOAT4_MAX, fallback: 0, places: 4 }),
      variantTax: clampDecimalFromInput(r.variantTax, { min: 0, max: 100, fallback: 0, places: 4 }),
    }));

    return safe;
  };

  // Single source of truth: build payload (NO stale state)
  const buildPayload = (formData) => {
    const base = sanitizeForDb({ ...formData, companyPk: companyData }, tableRows);

    // representative from localStorage
    const user = JSON.parse(localStorage.getItem("user") || "null");
    const representativePk = user?.pk || null;
    const representativeName =
      user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

    const vendors = vendorsListRef.current;
    const destinations = destinationsListRef.current;

    const destinationName =
      destinations.find((d) => String(d.pk) === String(base.destinationPk))?.name || null;

    const vendorName =
      vendors.find((v) => String(v.pk) === String(base.vendorPk))?.name || null;

    return {
      ...base,
      representativePk,
      representativeName,
      destinationName,
      vendorName,
      customPoNumber: poNumberMode === "custom",
    };
  };

  // Generic poster used by each submission function.
  const postTo = async ({ 
    method = "post", 
    endpoint, 
    payload, 
    onSuccess = () => {}, 
    triggerManualRefresh = false, 
    pageReload = false,
  }) => {
    setFinalDialog((prev) => ({
      ...prev,
      open: true,
      loadingText: "Saving Purchase Order...",
      severity: "info",
      severityText: "",
    }));

    try {
      const response = await axios({
        method,
        url: endpoint,
        data: payload,
      });

      const createdPoListPk = response.data?.poListPk ?? poListPk;

      if (response.status === 200) {
        await onSuccess?.(response);

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "success",
          severityText: "Purchase Order saved successfully!",
        }));

        navigate(`/purchase-order/${createdPoListPk}`);
        if (triggerManualRefresh) {
          triggerDataReload((prev) => !prev);
        }

        if (pageReload) {
          window.location.reload();
        }
      }
    } catch (error) {
      const status = error?.response?.status;
      const code = error?.response?.data?.errorCode;

      console.error(error);

      if (status === 409 && code === "VARIANTS_SOFT_DELETED") {
        const softDeleted = error?.response?.data?.softDeleted || [];

        // If backend sent snapshots, use them.
        // If it didn't (or sent partial), we can also fall back to filtering current tableRows.
        const deletedSet = new Set(softDeleted.map((r) => String(r?.variantPk)));

        // Capture the removed rows (from current tableRows) so the grid is guaranteed to match your columns
        setTableRows((prev) => {
          const prevRows = Array.isArray(prev) ? prev : [];

          const softDeletedRows = prevRows.filter((r) => deletedSet.has(String(r?.variantPk)));

          // ✅ keep deleted rows if inventory was received; mark them
          const mustKeep = softDeletedRows
            .filter((r) => Number(r?.qtyReceived || 0) > 0)
            .map((r) => ({ ...r, deletedButReceived: true }));

          // ✅ safe to remove/separate
          const safeToRemove = softDeletedRows.filter((r) => Number(r?.qtyReceived || 0) === 0);

          const kept = prevRows.filter((r) => !deletedSet.has(String(r?.variantPk)));

          // update removed grid
          if (safeToRemove.length > 0) {
            const reassignedRemoved = safeToRemove.map((r, i) => ({ ...r, uid: i + 1 }));
            setRemovedVariantRows(reassignedRemoved);
            setRemovedVariantsOpen(true);
          } else {
            setRemovedVariantRows([]);
            setRemovedVariantsOpen(false);
          }

          // main grid includes kept + mustKeep
          const combined = [...kept, ...mustKeep].map((r, i) => ({ ...r, uid: i + 1 }));
          return combined;
        });

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "warning",
          severityText: `Warning: One or more variants no longer exist in SyncBooks and were removed.
          ${" "}Save the Purchase Order again to continue.`,
        }));

        return;
      }

      if (status === 409 && code === "PO_NUMBER_IN_USE") {
        setError("poNumber", {
          type: "server",
          message: "This PO Number is already in use.",
        });
        setShake(true);
        setTimeout(() => setShake(false), 600);

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "error",
          severityText: `Failed to save purchase order: The provided PO Number is already in use.`,
        }));

        return;
      }

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        severityText: `Failed to save purchase order: ${error?.message || "Unknown error"}`,
      }));
    }
  };

  // -----------------------------
  // Actions (NO submitAction state)
  // -----------------------------
  const saveDraft = handleSubmit(async (formData) => {
    if (everythingDisabled) return;
    
    const payload = buildPayload(formData);

    await postTo({
      method: "post",
      endpoint: "http://localhost:4000/purchase-order/draft",
      payload,
    });
  });

  const updateDraft = handleSubmit(async (formData) => {
    if (everythingDisabled) return;

    const payload = {
      ...buildPayload(formData),
      poListPk, // IMPORTANT: PUT needs to know which draft to update
    };

    await postTo({
      method: "put",
      endpoint: "http://localhost:4000/purchase-order/draft",
      payload,
    });
  });

  const createOfficialPo = async () => {
    if (everythingDisabled) return;

    // Clear old errors (so you get a clean rerun each click)
    clearErrors(["vendorPk", "destinationPk", "poNumber", "rows"]);

    // Run RHF validation rules (Controller rules)
    const ok = await trigger();
    if (!ok) return;

    // Pull latest values and run your grid/header validation
    const formData = getValues();
    if (!validateCreatePO(formData)) return;

    const payload = { ...buildPayload(formData), poListPk };

    await postTo({
      endpoint: "http://localhost:4000/purchase-order/create",
      payload,
      onSuccess: () => {},
      triggerManualRefresh: true,
      pageReload: true,
    });
  };

  const updateOfficialPo = async () => {
    if (everythingDisabled) return;

    // Clear old errors so RHF doesn't block the click before we can re-validate.
    clearErrors(["vendorPk", "destinationPk", "poNumber", "rows"]);

    // Run Controller rules / RHF validation
    const ok = await trigger();
    if (!ok) return;

    // Validate against current grid state (tableRows) and header fields
    const latest = getValues();
    if (!validateEditPO(latest)) return;

    const payload = { ...buildPayload(latest), poListPk };

    await postTo({
      method: "put",
      endpoint: "http://localhost:4000/purchase-order/edit",
      payload,
      triggerManualRefresh: true,
      pageReload: false,
    });
  };

  const handleClosePurchaseOrder = async () => {
    // already closed or UI locked -> do nothing
    if (everythingDisabled || String(poStatus || "") === "Closed") return;
    if (!companyData || isNaN(companyData) || !Number.isFinite(poListPk) || poListPk <= 0) return;

    setFinalDialog((prev) => ({
      ...prev,
      open: true,
      loadingText: "Closing Purchase Order...",
      severity: "info",
      severityText: "",
    }));

    try {
      // ✅ You implement this route in your backend:
      // PUT http://localhost:4000/purchase-order/close
      const res = await axios.put("http://localhost:4000/purchase-order/close", {
        companyPk: companyData,
        poListPk,
      });

      if (res.status === 200) {
        // lock UI immediately
        setPoStatus("Closed");
        setValue("status", "Closed", { shouldDirty: false, shouldValidate: true });
        setEverythingDisabled(true);

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "success",
          loadingText: "",
          severityText: "Purchase Order closed successfully.",
        }));

        // optional: refresh if you want any server-calculated fields updated
        triggerDataReload((prev) => !prev);
      }
    } catch (error) {
      console.error(error);

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: `Failed to close purchase order: ${error?.message || "Unknown error"}`,
      }));
    }
  };

  const handleQuickDuplicate = () => {
    closeDuplicateMenu();
    // TODO: implement
  };

  const handleCustomDuplicate = () => {
    closeDuplicateMenu();
    // TODO: implement
  };

  const handleReceiveInventory = (e) => {
    e.preventDefault();
    if (finalizationController.disableFields || ["Closed", "Complete"].includes(String(poStatus || "").trim())) return;
    if (!Number.isFinite(poListPk) || poListPk <= 0) return;

    openRedirectWarning({
      title: "Receive inventory for this purchase order?",
      message:
        "You are about to leave this page to receive inventory for this purchase order. Any unsaved changes made here will be lost.",
      stayText: "Stay",
      leaveText: "Continue",
      onConfirm: () => navigate(`/receive/${poListPk}`),
    });
  };

  const handlePlaceOnHold = async () => {
    // already on hold or UI locked -> do nothing
    if (everythingDisabled || String(poStatus || "") === "On Hold") return;
    if (!companyData || isNaN(companyData) || !Number.isFinite(poListPk) || poListPk <= 0) return;

    setFinalDialog((prev) => ({
      ...prev,
      open: true,
      loadingText: "Placing Purchase Order on hold...",
      severity: "info",
      severityText: "",
    }));

    try {
      const res = await axios.put("http://localhost:4000/purchase-order/on-hold", {
        companyPk: companyData,
        poListPk,
      });

      if (res.status === 200) {
        setPoStatus("On Hold");
        setValue("status", "On Hold", { shouldDirty: false, shouldValidate: true });

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "success",
          loadingText: "",
          severityText: "Purchase Order placed on hold successfully.",
        }));

        triggerDataReload((prev) => !prev);
      }
    } catch (error) {
      console.error(error);

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: `Failed to place purchase order on hold: ${error?.message || "Unknown error"}`,
      }));
    }
  };

  const handleOpenPurchaseOrder = async () => {
    // not on hold or UI locked -> do nothing
    if (everythingDisabled || String(poStatus || "") !== "On Hold") return;
    if (!companyData || isNaN(companyData) || !Number.isFinite(poListPk) || poListPk <= 0) return;

    setFinalDialog((prev) => ({
      ...prev,
      open: true,
      loadingText: "Reopening Purchase Order...",
      severity: "info",
      severityText: "",
    }));

    try {
      const res = await axios.put("http://localhost:4000/purchase-order/open", {
        companyPk: companyData,
        poListPk,
      });

      if (res.status === 200) {
        setPoStatus("Open");
        setValue("status", "Open", { shouldDirty: false, shouldValidate: true });

        setFinalDialog((prev) => ({
          ...prev,
          open: true,
          severity: "success",
          loadingText: "",
          severityText: "Purchase Order reopened successfully.",
        }));

        triggerDataReload((prev) => !prev);
      }
    } catch (error) {
      console.error(error);

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: `Failed to reopen purchase order: ${error?.message || "Unknown error"}`,
      }));
    }
  };

  const onClickExportPDF = async () => {
    if (isDraftPo) return;
    // Exports the selected PO to PDF format. Does not work on drafts.
    try {
      const pdfUrl = `http://localhost:4000/purchase-order/export/pdf`
      + `?PoNumber=${getFullPoNumber(poNumberValue)}&companyPk=${companyData}`;
      window.open(pdfUrl, "_blank");
    } catch (error) {
      console.error("Error fetching purchase order data:", error);
    }
  };

  // -----------------------------
  // Initial data fetch
  // -----------------------------
  useEffect(() => {
    if (isNaN(companyData)) return;

    const toDateOrNull = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const fetchInitialData = async () => {
      try {
        setFinalizationController((prev) => ({
          ...prev,
          visible: true,
          disableFields: pageType !== "Add",
          loading: true,
          severity: "info",
          finalResultText: "",
        }));

        reset(defaultValues);
        setTableRows([]);

        // 1) Lists for dropdowns
        const listsRes = await axios.get("http://localhost:4000/purchase-order/data-for-new", {
          params: { companyPk: companyData },
        });

        const nextVendors = listsRes.data?.vendorsList || [];
        const nextDestinations = listsRes.data?.warehousesList || [];

        setVendorsList(nextVendors);
        setDestinationsList(nextDestinations);

        const settings = listsRes.data?.poSettings || { usePrefixSuffix: false, prefix: "", suffix: "" };
        setPoSettings(settings);

        if (pageType === "Add") {
          setPoNumberMode("auto");

          console.log(listsRes);
          

          // IMPORTANT: do NOT generate/set a PO number on initial load.
          setGeneratedPoNumber(listsRes.data?.generatedPoNumber ?? "");
          setValue("poNumber", listsRes.data?.generatedPoNumber ?? "", { shouldDirty: false, shouldValidate: true });

          setRowsBeingAdded(false);
          setIsDraftPo(true);

          setFinalizationController((prev) => ({
            ...prev,
            visible: false,
            disableFields: false,
            loading: false,
          }));
          return;
        }

        // 2) Load the PO by URL param
        if (!Number.isFinite(poListPk) || poListPk <= 0) {
          throw new Error("Invalid purchase order id in URL.");
        }

        // ✅ You’ll implement this endpoint (see section 2)
        const poRes = await axios.get(`http://localhost:4000/purchase-order`, {
          params: { companyPk: companyData, poListPk },
        });

        const header = poRes.data?.po || {};
        const lines = poRes.data?.lines || [];

        setPoStatus(String(header.status || "Open"));
        setIsDraftPo(String(header.status || "") === "Draft");
        setEverythingDisabled(String(header.status || "") === "Closed");

        const loadedIsDraft = String(header.status || "") === "Draft";

        if (loadedIsDraft) {
          // set select + field based on stored poNumber
          applyLoadedPoNumberMode(header.poNumber, header.customPoNumber);
        }

        const discountPercentNum = Number(header.discountPercent || 0);
        const discountAmountNum = Number(header.discountAmount || 0);

        const nextDefaults = {
          ...defaultValues,

          status: String(header.status || "Open"),

          poNumber: (() => {
            const raw = String(header.poNumber || "").trim();
            if (!raw) return "";

            if (String(header.status || "") === "Draft") {
              return raw;
            }

            // Non-draft: keep full as-is
            return raw;
          })(),
          vendorPk: header.vendorPk ? String(header.vendorPk) : "",
          destinationPk: header.destinationPk ? String(header.destinationPk) : "",
          paymentTerms: header.paymentTerms || "",
          vendorCurrency: header.paymentCurrency || "USD",

          dueDate: toDateOrNull(header.dueDate),
          dateToShip: toDateOrNull(header.dateToShip),
          dateVoid: toDateOrNull(header.dateVoid),

          shippingCarrier: header.shippingCarrier || "",
          trackingNumber: header.trackingNum || "",
          referenceNumber: header.referenceNumber || "",
          noteToVendor: header.vendorNote || "",

          discountPercent: discountPercentNum,
          discountAmount: discountAmountNum,

          discountValue: discountPercentNum !== 0
            ? discountPercentNum
            : discountAmountNum !== 0
              ? discountAmountNum
              : 0,

          freight: Number(header.freight || 0),
          fee: Number(header.fee || 0),
          tax: Number(header.tax || 0),

          subtotal: Number(header.subtotal || 0),
          total: Number(header.total || 0),

          rows: [],
        };
        
        setDefaultValues(nextDefaults);
        reset(nextDefaults);

        // 4) Rebuild tableRows from po_data snapshot fields
        
        // const isDraftPo = !!header?.isDraft;
        const isDraftPo = String(header.status || "") === "Draft";

        if (isDraftPo) {
          applyLoadedPoNumberMode(header.poNumber, header.customPoNumber);
        }

        const mapLineToRow = (r, i) => {
          const isExtra = !!r.isExtra;

          const qty = clampIntFromInput(r.qtyOrdered, { min: isExtra ? 0 : 1, max: PG_INT_MAX, fallback: 1 });
          const cost = clampDecimalFromInput(r.cost, { min: 0, max: PG_FLOAT4_MAX, fallback: 0, places: 4 });
          const tax = clampDecimalFromInput(r.variantTax, { min: 0, max: 100, fallback: 0, places: 4 });

          const base = cost * qty;
          const taxed = base * (1 + tax / 100);

          const variantSoftDeleted = !!r.variantSoftDeleted || !r.variantExists;
          const productSoftDeleted = !!r.productSoftDeleted || !r.productExists;

          const qtyReceivedNum = clampIntFromInput(r.qtyReceived, { min: 0, max: PG_INT_MAX, fallback: 0 });

          return {
            uid: i + 1,

            isExtra: r.isExtra,

            productPk: r.productPk,
            variantPk: r.variantPk,

            productTitle: r.productTitle,
            variantTitle: r.variantTitle,
            variantSku: r.variantSku,
            variantDescriptionPurchase: r.variantDescriptionPurchase,
            variantDescriptionPurchaseBaseline: String(
              r?.variantDescriptionPurchaseCurrent ?? r?.variantDescriptionPurchase ?? ""
            ).trim(),

            headerImage: r.headerImage || "",

            qtyOrdered: qty,
            qtyReceived: qtyReceivedNum,
            qtyOnOrder: Number(r?.qtyOnOrder || 0),
            qtyOnHand: Number(r?.qtyOnHand || 0),
            cost,
            variantTax: tax,
            costExtended: roundTo(taxed, 4),

            productDeleted: productSoftDeleted,
            variantDeleted: variantSoftDeleted,

            // ✅ NEW: this row is deleted but inventory was received against it
            deletedButReceived: variantSoftDeleted && qtyReceivedNum > 0,
          };
        };

        const allLines = Array.isArray(lines) ? lines : [];

        if (isDraftPo) {
          // Treat as "removed" if soft-deleted OR backend says it no longer exists.
          // (Handles boolean false, 0, "false", null, etc.)
          const isVariantRemoved = (l) => {
            const softDeleted = !!l?.variantSoftDeleted;

            const existsRaw = l?.variantExists;
            const exists =
              existsRaw === undefined || existsRaw === null
                ? true
                : !(
                    existsRaw === false ||
                    existsRaw === 0 ||
                    String(existsRaw).toLowerCase() === "false"
                  );

            return softDeleted || !exists;
          };

          const removedLines = allLines.filter(isVariantRemoved);
          const keptLines = allLines.filter((l) => !isVariantRemoved(l));


          const keptRows = keptLines.map(mapLineToRow);
          const removedRows = removedLines.map(mapLineToRow);

          // ✅ If deleted rows have qtyReceived > 0, they MUST stay in the main grid (marked red)
          const receivedNum = (r) => clampIntFromInput(r?.qtyReceived, { min: 0, max: PG_INT_MAX, fallback: 0 });

          const removedWithReceived = removedRows.filter((r) => receivedNum(r) > 0);
          const removedSafeToSeparate = removedRows.filter((r) => receivedNum(r) === 0);

          // main grid includes normal kept + deleted-but-received
          const combinedMain = [...keptRows, ...removedWithReceived].map((r, idx) => ({
            ...r,
            uid: idx + 1,
          }));

          setTableRows(combinedMain);

          if (removedSafeToSeparate.length > 0) {
            // separate grid is ONLY the deleted rows with qtyReceived == 0
            const reassignedRemoved = removedSafeToSeparate.map((r, idx) => ({ ...r, uid: idx + 1 }));
            setRemovedVariantRows(reassignedRemoved);
            setRemovedVariantsOpen(true);
          } else {
            setRemovedVariantRows([]);
            setRemovedVariantsOpen(false);
          }
        } else {
          // Not a draft → separate removed variants too (unless they have qtyReceived > 0)
          const rebuiltRows = allLines.map(mapLineToRow);

          const removedWithReceived = rebuiltRows.filter(
            (r) => !!r.variantDeleted && Number(r?.qtyReceived || 0) > 0
          );

          const removedSafeToSeparate = rebuiltRows.filter(
            (r) => !!r.variantDeleted && Number(r?.qtyReceived || 0) === 0
          );

          const keptRows = rebuiltRows.filter((r) => !r.variantDeleted);

          // main grid = normal rows + deleted-but-received rows
          const combinedMain = [...keptRows, ...removedWithReceived].map((r, idx) => ({
            ...r,
            uid: idx + 1,
          }));

          setTableRows(combinedMain);

          console.log(combinedMain);

          if (removedSafeToSeparate.length > 0) {
            const reassignedRemoved = removedSafeToSeparate.map((r, idx) => ({
              ...r,
              uid: idx + 1,
            }));
            setRemovedVariantRows(reassignedRemoved);
            setRemovedVariantsOpen(true);
          } else {
            setRemovedVariantRows([]);
            setRemovedVariantsOpen(false);
          }

          console.log({
            kept: keptRows.length,
            removedSafe: removedSafeToSeparate.length,
            removedButReceived: removedWithReceived.length,
          });
        }

        setRowsBeingAdded(false);
        setFinalizationController((prev) => ({
          ...prev,
          visible: false,
          disableFields: false,
          loading: false,
        }));
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
  }, [companyData, reset, pageType, poListPk, dataReload]);

  // -----------------------------
  // Navbar actions injection
  // -----------------------------
  const openSaveMenu = (e) => setSaveMenuAnchorEl(e.currentTarget);
  const closeSaveMenu = () => setSaveMenuAnchorEl(null);

  //Navbar Actions
  useEffect(() => {
    const isAddPage = pageType === "Add";
    const isEditPage = pageType === "Edit";

    setNavbarActions(
      isMobile ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            gap: 1,
            px: 0.5,
            py: 0.5,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            animation: shake ? "shake 0.5s" : "none",
            "@keyframes shake": {
              "0%, 100%": { transform: "translateX(0)" },
              "20%": { transform: "translateX(-4px)" },
              "40%": { transform: "translateX(4px)" },
              "60%": { transform: "translateX(-4px)" },
              "80%": { transform: "translateX(4px)" },
            },
          }}
        >
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => navigate("/purchase-orders")}
            fullWidth
            type="button"
          >
            Cancel
          </Button>

          {isAddPage && (
            <Button
              variant="contained"
              color="primary"
              fullWidth
              disabled={finalizationController.disableFields || everythingDisabled}
              onClick={saveDraft}
              type="button"
            >
              Save Draft
            </Button>
          )}

          {isEditPage && (
            isDraftPo ? (
              <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={finalizationController.disableFields || everythingDisabled}
                onClick={openSaveMenu}
                type="button"
                startIcon={<MoreVertIcon/>}
              >
                Save
              </Button>
            ) : (
              <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={finalizationController.disableFields || everythingDisabled}
                onClick={updateOfficialPo}
                type="button"
              >
                Save
              </Button>
            )
          )}

          {!isAddPage && !isEditPage && (
            <Button
              variant="contained"
              color="primary"
              fullWidth
              disabled={finalizationController.disableFields || everythingDisabled}
              onClick={updateDraft}
              type="button"
              startIcon={<MoreVertIcon/>}
            >
              Save
            </Button>
          )}
        </Box>
      ) : (
        <Alert
          severity="info"
          sx={{
            display: "flex",
            alignItems: "center",
            animation: shake ? "shake 0.5s" : "none",
            "@keyframes shake": {
              "0%, 100%": { transform: "translateX(0)" },
              "20%": { transform: "translateX(-4px)" },
              "40%": { transform: "translateX(4px)" },
              "60%": { transform: "translateX(-4px)" },
              "80%": { transform: "translateX(4px)" },
            },
          }}
        >
          <span>Save your changes here: </span>

          <Button
            variant="outlined"
            color="inherit"
            onClick={() => navigate("/purchase-orders")}
            style={{ marginRight: "10px" }}
            type="button"
          >
            Cancel
          </Button>

          {isAddPage && (
            <Button
              variant="contained"
              color="primary"
              onClick={saveDraft}
              disabled={finalizationController.disableFields || everythingDisabled}
              type="button"
            >
              Save Draft
            </Button>
          )}

          {isEditPage && (
            isDraftPo ? (
              <Button
                variant="contained"
                color="primary"
                onClick={openSaveMenu}
                disabled={finalizationController.disableFields || everythingDisabled}
                type="button"
                startIcon={<MoreVertIcon/>}
              >
                Save
              </Button>
            ) : (
              <Button
                variant="contained"
                color="primary"
                onClick={updateOfficialPo}
                disabled={finalizationController.disableFields || everythingDisabled}
                type="button"
              >
                Save
              </Button>
            )
          )}

          {!isAddPage && !isEditPage && (
            <Button
              variant="contained"
              color="primary"
              onClick={updateDraft}
              disabled={finalizationController.disableFields || everythingDisabled}
              type="button"
              startIcon={<MoreVertIcon/>}
            >
              Save
            </Button>
          )}
        </Alert>
      )
    );

    return () => setNavbarActions(null);
  }, [
    setNavbarActions,
    pageType,
    navigate,
    isMobile,
    shake,
    finalizationController.disableFields,
    everythingDisabled,
    tableRows
  ]);

  //Updates Vendors List and Destination List Ref's when Hooks get triggered.
  useEffect(() => {
    vendorsListRef.current = vendorsList;
  }, [vendorsList]);
  useEffect(() => {
    destinationsListRef.current = destinationsList;
  }, [destinationsList]);

  //Hides Po Number Availability Check Alert on Po Number change.
  useEffect(() => {
    setPoNumberCheckResult(null);
  }, [watch("poNumber"), poNumberMode]);

  //Disables everything on closed PO status.
  useEffect(() => {
    setEverythingDisabled(isReadOnlyStatus || hasAnyReceived);
  }, [isReadOnlyStatus, hasAnyReceived]);

  //Updates the quantity on hand column of all rows when switching destination warehouses.
  useEffect(() => {
    const destinationPk = String(watch("destinationPk") || "").trim();
    const rows = Array.isArray(tableRows) ? tableRows : [];

    if (!companyData || isNaN(companyData)) return;
    if (!destinationPk) return;
    if (rows.length === 0) return;

    const variantPks = Array.from(
      new Set(
        rows
          .map((r) => Number(r?.variantPk))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );

    if (variantPks.length === 0) return;

    const run = async () => {
      try {
        const res = await axios.get("http://localhost:4000/purchase-order/qty-on-hand", {
          params: {
            companyPk: companyData,
            destinationPk,
            variantPks: JSON.stringify(variantPks),
          },
        });

        const map = res.data?.qtyOnHandByVariantPk || {};

        setTableRows((prev) => {
          const next = Array.isArray(prev) ? [...prev] : [];
          return next.map((r) => ({
            ...r,
            qtyOnHand: Number(map[String(r.variantPk)] ?? 0),
          }));
        });
      } catch (error) {
        console.error("Error refreshing qtyOnHand:", error);
      }
    };

    run();
  }, [watch("destinationPk"), companyData]);

  useEffect(() => {
    if (!isReadOnlyStatus) return;

    // show once per page load (prevents repeats from rerenders)
    if (viewOnlySnackShownRef.current) return;
    viewOnlySnackShownRef.current = true;

    const s = String(poStatus || "").trim();
    setViewOnlySnackMsg(
      s === "Closed"
        ? "This Purchase Order is Closed and is now view only."
        : "This Purchase Order is Complete and is now view only."
    );
    setViewOnlySnackOpen(true);
  }, [isReadOnlyStatus, poStatus]);

  // -----------------------------
  // PO number generator
  // -----------------------------
  const handleGeneratePoNumber = async () => {
    if (!companyData || isNaN(companyData)) return;

    if (generatedPoNumber) {
      setValue("poNumber", String(generatedPoNumber), { shouldDirty: true, shouldValidate: true });
      return;
    }
    if (poNumberLoading) return;

    setPoNumberLoading(true);
    try {
      const res = await axios.get("http://localhost:4000/purchase-order/generate-po-number", {
        params: { companyPk: companyData },
      });

      const generated = res.data?.poNumber || "";
      setGeneratedPoNumber(String(generated));

      setValue("poNumber", String(generated), { shouldDirty: true, shouldValidate: true });
    } catch (error) {
      console.error(`Error generating PO number: ${error?.message || "Unknown error"}`);
      setSnackbarOpen(true);
    } finally {
      setPoNumberLoading(false);
    }
  };

  const getNormalizedPoNumberForCheck = () => {
    return String(getValues("poNumber") ?? "").trim();
  };

  const checkPoNumberAvailability = async () => {
    if (!companyData || isNaN(companyData)) return;
    if (poNumberCheckLoading) return;
    
    setPoNumberCheckLoading(true);

    const poNumberToCheck = getNormalizedPoNumberForCheck();
    if (!poNumberToCheck) {
      setPoNumberCheckResult({ available: false, message: "Enter a PO Number first." });
      setPoNumberCheckLoading(false);
      return;
    }

    try {
      const res = await axios.get("http://localhost:4000/purchase-order/check-po-number", {
        params: {
          companyPk: companyData,
          poNumber: poNumberToCheck,
          // If you are inside an existing PO, exclude it from the check:
          excludePoListPk: pageType === "Add" ? null : poListPk,
        },
      });

      const available = !!res.data?.available;
      setPoNumberCheckResult({
        available,
        message: available
          ? "Available: no other purchase order is using this PO Number."
          : "Not available: a purchase order is already using this PO Number.",
      });
    } catch (error) {
      console.error("Error checking PO number:", error);
      setPoNumberCheckResult({
        available: false,
        message: `Could not check availability: ${error?.message || "Unknown error"}`,
      });
    } finally {
      setPoNumberCheckLoading(false);
    }
  };

  // -----------------------------
  // UI helpers (unchanged)
  // -----------------------------
  const renderResetAdornment = (
    name,
    currentValue,
    { compare = (a, b) => String(a ?? "") !== String(b ?? ""), aria = `Reset ${name}` } = {}
  ) => {
    const original = defaultValues?.[name];
    const changed = compare(currentValue, original);
    if (!changed || pageType === "Add") return null;

    return (
      <InputAdornment position="end">
        <IconButton
          size="small"
          aria-label={aria}
          onClick={() => setValue(name, original, { shouldDirty: false, shouldValidate: true })}
          edge="end"
        >
          <CachedRoundedIcon />
        </IconButton>
      </InputAdornment>
    );
  };

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

  const receivedAsExtraCol = {
    ...LEFT,
    field: "isExtra",
    headerName: "Received As Extra",
    width: 170,
    sortable: false,
    filterable: true,
    valueGetter: (value) => Boolean(value),
    renderCell: (params) => (
      <Box sx={{ display: "flex", alignItems: "center", height: "100%" }}>
        {renderIsExtraChip(!!params.row?.isExtra)}
      </Box>
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

    ...(poStatus !== "Draft"
      ? [
          { ...LEFT, field: "qtyReceived", headerName: "Qty Received", width: 120 },
          {
            ...LEFT,
            field: "qtyDue",
            headerName: "Qty Due",
            width: 80,
            valueGetter: (value, row) => Math.max(0, Number(row?.qtyOrdered || 0) - Number(row?.qtyReceived || 0)),
          },
          ...(hasAnyExtraRows ? [receivedAsExtraCol] : []),
        ]
      : []
    ),

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

  const deletedVariantsDataGrid = useMemo(() => {
    return [...baseColumns];
  }, [baseColumns]);

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
          const row = params.row;

          if (everythingDisabled || parseInt(row.qtyReceived || 0, 10) > 0) {
            return [
              <GridActionsCellItem
                key="explain-action"
                icon={<QuestionMarkIcon />}
                onClick={() => setSnackbarOpen(true)}
                label="explain"
                color="inherit"
              />,
            ];
          }

          if (row?.deletedButReceived) {
            return [
              <GridActionsCellItem
                key="explain-action"
                icon={<QuestionMarkIcon />}
                onClick={() => setSnackbarOpen(true)}
                label="explain"
                color="inherit"
              />,
            ];
          }

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

    return isReadOnlyStatus ? [...baseColumns] : [actionsCol, ...baseColumns];
  }, [isReadOnlyStatus, baseColumns, tableRows, everythingDisabled]);

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

      {/* Top actions */}
      {!isAddPage && (
        <Box
          sx={{
            mt: 1,
            mb: 1.5,
            display: "flex",
            justifyContent: "flex-end",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          {/* Always show More Actions for existing POs (including Draft) so Draft can be closed */}
          <Button
            variant="outlined"
            startIcon={<MoreVertIcon />}
            onClick={openMoreActionsMenu}
            disabled={finalizationController.disableFields || everythingDisabled}
            type="button"
          >
            More Actions
          </Button>

          {!isDraftPo && (
            <Button
              variant="contained"
              href={
                finalizationController.disableFields ||
                ["Closed", "Complete"].includes(String(poStatus || "").trim()) 
                  ? ""
                  : `/receive/${poListPk}`
              }
              onClick={handleReceiveInventory}
              disabled={
                finalizationController.disableFields ||
                ["Closed", "Complete"].includes(String(poStatus || "").trim())
              }
              type="button"
            >
              Receive Inventory
            </Button>
          )}
        </Box>
      )}

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

              {showPoNumberControls && (
                <Box sx={{ display: "flex", gap: 2, alignItems: "center", mb: 1 }}>
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel id="po-number-mode-label">PO number type</InputLabel>
                    <Select
                      labelId="po-number-mode-label"
                      label="PO number type"
                      value={poNumberMode}
                      disabled={finalizationController.disableFields || everythingDisabled || poNumberLoading}
                      onChange={async (e) => {
                        const next = e.target.value;

                        if (next === "auto") {
                          // Only generate when user explicitly switches to auto.
                          if (poNumberMode !== "auto") {
                            setPoNumberMode("auto");

                            if (!generatedPoNumber) {
                              await handleGeneratePoNumber();
                            } else {
                              setValue("poNumber", String(generatedPoNumber), { shouldDirty: true, shouldValidate: true });
                            }
                          }
                          return;
                        }

                        setPoNumberMode("custom");
                      }}
                    >
                      <MenuItem value="custom">Custom PO Number</MenuItem>
                      <MenuItem value="auto">Auto generated</MenuItem>
                    </Select>
                  </FormControl>

                  {poNumberMode === "auto" && (
                    <Typography variant="body2" color="text.secondary">
                      Auto number is locked.
                    </Typography>
                  )}
                </Box>
              )}

              <Controller
                name="poNumber"
                control={control}
                render={({ field }) => {
                  const isCreateOrDraft = pageType === "Add" || isDraftPo;
                  const isAuto = isCreateOrDraft && poNumberMode === "auto";

                  const shouldShowPrefixSuffix = (pageType === "Add" || isDraftPo) && poSettings.usePrefixSuffix;

                  const prefix = shouldShowPrefixSuffix ? String(poSettings.prefix || "") : "";
                  const suffix = shouldShowPrefixSuffix ? String(poSettings.suffix || "") : "";

                  return (
                    <TextField
                      {...field}
                      fullWidth
                      variant="standard"
                      disabled={finalizationController.disableFields || everythingDisabled || poNumberLoading}
                      value={field.value ?? ""}
                      error={!!errors.poNumber}
                      helperText={
                        errors.poNumber?.message ||
                        (poNumberReadOnly ? "PO Number cannot be changed after creation." :
                          (isAuto ? (poNumberLoading ? "Generating…" : "This PO number was auto generated and cannot be edited.") : ""))
                      }
                      onChange={(e) => {
                        if (poNumberReadOnly || isAuto) return;
                        if (errors.poNumber) clearErrors("poNumber");
                        field.onChange(e.target.value);
                      }}
                      InputProps={{
                        readOnly: poNumberReadOnly || isAuto,
                        startAdornment: prefix ? (
                          <InputAdornment position="start">
                            <Typography sx={{ fontWeight: 700 }} color="text.secondary">
                              {prefix}
                            </Typography>
                          </InputAdornment>
                        ) : null,
                        endAdornment: (
                          <InputAdornment position="end">
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              {suffix ? (
                                <Typography sx={{ fontWeight: 700 }} color="text.secondary">
                                  {suffix}
                                </Typography>
                              ) : null}

                              {renderResetAdornment(field.name, field.value, { aria: "Reset PO Number" })}
                            </Box>
                          </InputAdornment>
                        ),
                      }}
                    />
                  );
                }}
              />

              {showPoNumberControls && !!poNumberCheckResult && (
                <Alert
                  severity={poNumberCheckResult.available ? "success" : "error"}
                  sx={{ mt: 1 }}
                  onClose={() => setPoNumberCheckResult(null)}
                >
                  {poNumberCheckResult.message}
                </Alert>
              )}

              {showPoNumberControls && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={
                      finalizationController.disableFields ||
                      everythingDisabled ||
                      poNumberLoading ||
                      poNumberCheckLoading
                    }
                    onClick={checkPoNumberAvailability}
                    type="button"
                  >
                    {poNumberCheckLoading ? "Checking..." : "Check Availability"}
                  </Button>
                </Box>
              )}
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
                <Grid item xs={12} md={4}>
                  <Controller
                    name="dueDate"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Due Date"
                          disabled={finalizationController.disableFields || everythingDisabled}
                          minDate={today}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              InputProps: {
                                startAdornment: renderResetAdornment(field.name, field.value, {
                                  compare: (a, b) =>
                                    String(a?.getTime?.() || "") !== String(b?.getTime?.() || ""),
                                }),
                              },
                            },
                          }}
                        />
                      </LocalizationProvider>
                    )}
                  />
                </Grid>

                <Grid item xs={12} md={4}>
                  <Controller
                    name="dateToShip"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Date To Ship"
                          disabled={finalizationController.disableFields || everythingDisabled}
                          minDate={today}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              InputProps: {
                                startAdornment: renderResetAdornment(field.name, field.value, {
                                  compare: (a, b) =>
                                    String(a?.getTime?.() || "") !== String(b?.getTime?.() || ""),
                                }),
                              },
                            },
                          }}
                        />
                      </LocalizationProvider>
                    )}
                  />
                </Grid>

                <Grid item xs={12} md={4}>
                  <Controller
                    name="dateVoid"
                    control={control}
                    render={({ field }) => (
                      <LocalizationProvider dateAdapter={AdapterDateFns}>
                        <DatePicker
                          {...field}
                          label="Date Void"
                          disabled={finalizationController.disableFields || everythingDisabled}
                          minDate={today}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              InputProps: {
                                startAdornment: renderResetAdornment(field.name, field.value, {
                                  compare: (a, b) =>
                                    String(a?.getTime?.() || "") !== String(b?.getTime?.() || ""),
                                }),
                              },
                            },
                          }}
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
                  item
                  xs={12}
                  md={6}
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
                    rules={showPoNumberControls ? {} : { required: "Vendor is required" }}
                    render={({ field }) => (
                      <FormControl fullWidth error={!!errors.vendorPk}>
                        <Select
                          {...field}
                          displayEmpty
                          variant="outlined"
                          disabled={finalizationController.disableFields || everythingDisabled}
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

                        {!!errors.vendorPk && <FormHelperText>{errors.vendorPk.message}</FormHelperText>}
                      </FormControl>
                    )}
                  />
                </Grid>

                {/* Destination */}
                <Grid
                  item
                  xs={12}
                  md={6}
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
                          disabled={finalizationController.disableFields || everythingDisabled}
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
                <Grid item xs={12} md={6} sx={{ p: 2 }}>
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
                          disabled={finalizationController.disableFields || everythingDisabled}
                          renderValue={(value) => {
                            const found = paymentTermsList.find((x) => String(x.value) === String(value));
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
                <Grid item xs={12} md={6} sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Vendor currency
                  </Typography>

                  <Controller
                    name="vendorCurrency"
                    control={control}
                    rules={{ required: "Currency is required" }}
                    render={({ field }) => {
                      const selected = WORLD_CURRENCIES.find((c) => c.value === field.value) || null;

                      return (
                        <FormControl fullWidth error={!!errors.vendorCurrency}>
                          <Autocomplete
                            options={WORLD_CURRENCIES}
                            value={selected}
                            onChange={(_, option) => field.onChange(option?.value || "")}
                            disabled={finalizationController.disableFields || everythingDisabled}
                            getOptionLabel={(option) =>
                              option?.label ? `${option.label} (${option.value})` : ""
                            }
                            isOptionEqualToValue={(option, value) => option.value === value.value}
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
              <Grid item xs={12} md={6}>
                <Controller
                  name="shippingCarrier"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <TextField
                        {...field}
                        label="Shipping carrier"
                        disabled={finalizationController.disableFields || everythingDisabled}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(clampText(e.target.value, MAX_SHIPPING_CARRIER))}
                        inputProps={{ maxLength: MAX_SHIPPING_CARRIER }}
                        InputProps={{ endAdornment: renderResetAdornment(field.name, field.value) }}
                      />
                    </FormControl>
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="trackingNumber"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Tracking number"
                      disabled={finalizationController.disableFields || everythingDisabled}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(clampText(e.target.value, MAX_TRACKING))}
                      inputProps={{ maxLength: MAX_TRACKING }}
                      InputProps={{ endAdornment: renderResetAdornment(field.name, field.value) }}
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
              companyPk={companyData}
              darkMode={darkMode}
              disabled={finalizationController.disableFields || everythingDisabled}
              onAddSelected={(selectedProducts) => getItemDetails(selectedProducts)}
            />

            {removedVariantsOpen && removedVariantRows.length > 0 && (
              <Box
                sx={{
                  mt: 2,
                  border: "1px solid",
                  borderColor: "error.main",
                  borderRadius: 2,
                  p: 2,
                  position: "relative",
                  backgroundColor: darkMode ? "#1e1e1e" : "#fff",
                }}
              >
                <IconButton
                  aria-label="Close"
                  onClick={() => setRemovedVariantsOpen(false)}
                  sx={{ position: "absolute", top: 8, right: 8 }}
                >
                  <CloseIcon />
                </IconButton>

                <Alert severity="error" sx={{ mb: 2, pr: 6 }}>
                  The following items have been removed from the purchase order because they no longer exist in SyncBooks.
                </Alert>

                <Box
                  sx={{
                    width: "100%",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: sectionBorder,
                    height: "360px",
                    overflow: "auto",
                  }}
                >
                  <DataGrid
                    apiRef={apiRef}
                    rows={removedVariantRows}
                    columns={deletedVariantsDataGrid}
                    loading={false}
                    disableRowSelectionOnClick
                    getRowId={(row) => row.uid}
                    sx={{
                      border: "none",
                      "& .MuiDataGrid-cell--editable": {
                        backgroundColor: darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.04)",
                        fontWeight: 600,
                      },
                    }}
                    localeText={{ noRowsLabel: "No removed variants." }}
                    isCellEditable={() => false}
                  />
                </Box>
              </Box>
            )}

            {deletedReceivedRows.length > 0 && (
              <Alert severity="error" sx={{ mt: 2 }}>
                One or more items on this purchase order no longer exist in SyncBooks, but have received inventory.
                These rows are highlighted in red and remain purely for history purposes.
              </Alert>
            )}

            <Box
              sx={{
                mt: 2,
                width: "calc(100% - 1px)",
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
                isCellEditable={(params) =>
                  !everythingDisabled &&
                  (params.row.qtyReceived || 0) === 0 &&
                  !params.row?.deletedButReceived
                }
                getRowClassName={(params) => {
                  return params.row?.deletedButReceived ? "row-deleted-received" : "";
                }}
                sx={{
                  border: "none",
                  "& .MuiDataGrid-cell--editable": {
                    backgroundColor: darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.04)",
                    fontWeight: 600,
                  },

                  "& .row-deleted-received": {
                    backgroundColor: darkMode ? "rgba(244, 67, 54, 0.22)" : "rgba(244, 67, 54, 0.12)",
                  },
                  "& .row-deleted-received:hover": {
                    backgroundColor: darkMode ? "rgba(244, 67, 54, 0.28)" : "rgba(244, 67, 54, 0.16)",
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

          <Dialog
            open={purchDescEditor.open}
            onClose={closePurchDescEditor}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle sx={{ fontWeight: 800 }}>
              Edit Purchase Description
            </DialogTitle>

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
              everythingDisabled={finalizationController.disableFields || everythingDisabled}
              isMobile={isMobile}
              defaultValues={{
                discountPercent: defaultValues.discountPercent,
                discountAmount: defaultValues.discountAmount,
                freight: defaultValues.freight,
                fee: defaultValues.fee,
                tax: defaultValues.tax,
              }}
              hideFields={["subtotal", "total", "tax"]}
            />
          </Box>

          {/* Bottom row: Additional details + Cost summary */}
          <Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
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
                        disabled={finalizationController.disableFields || everythingDisabled}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(clampText(e.target.value, MAX_REFERENCE))}
                        inputProps={{ maxLength: MAX_REFERENCE }}
                        InputProps={{ endAdornment: renderResetAdornment(field.name, field.value) }}
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
                        disabled={finalizationController.disableFields || everythingDisabled}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(clampText(e.target.value, MAX_VENDOR_NOTE))}
                        inputProps={{ maxLength: MAX_VENDOR_NOTE }}
                        InputProps={{ endAdornment: renderResetAdornment(field.name, field.value) }}
                      />
                    )}
                  />
                </Box>
              </Grid>

              <Grid item xs={12} md={6}>
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
                        <Box key={label} sx={{ mt: 0.75, display: "flex", justifyContent: "space-between" }}>
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
                          {discountPercent > 0 && line(`Discount (${discountPercent}%)`, percentDiscountValue, true)}
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

      {companyData && (
        <QuickCreateVendorComponent
          open={quickVendorOpen}
          onClose={() => setQuickVendorOpen(false)}
          companyPk={companyData}
          disable={finalizationController.disableFields || everythingDisabled}
          onCreated={(createdVendor) => {
            setVendorsList((prev) => {
              const next = Array.isArray(prev) ? [...prev] : [];
              const exists = next.some((v) => String(v.pk) === String(createdVendor.pk));
              if (!exists) next.push(createdVendor);
              next.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
              return next;
            });

            setValue("vendorPk", String(createdVendor.pk), { shouldDirty: true, shouldValidate: true });
          }}
        />
      )}

      {/* Shows Navigation/redirect errors. */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3500}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity="warning"
          sx={{
            width: "100%",
            animation: shake ? "shake 0.5s" : "none",
            "@keyframes shake": {
              "0%, 100%": { transform: "translateX(0)" },
              "20%": { transform: "translateX(-6px)" },
              "40%": { transform: "translateX(6px)" },
              "60%": { transform: "translateX(-6px)" },
              "80%": { transform: "translateX(6px)" },
            },
          }}
        >
          {isClosedPo
            ? "This PO is Closed. Editing is turned off."
            : isCompletePo
              ? "This PO is Complete. Editing is turned off."
              : hasAnyReceived
                ? "Inventory has been received for this PO. Editing is locked. Use Receive Inventory to continue."
                : "Cannot edit rows for which inventory has been received."}
        </Alert>
      </Snackbar>

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

      {/* Duplicate menu */}
      {/* <Menu
        anchorEl={duplicateMenuAnchorEl}
        open={duplicateMenuOpen}
        onClose={closeDuplicateMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          disabled={finalizationController.disableFields || everythingDisabled}
          onClick={() => {
            closeDuplicateMenu();

            openRedirectWarning({
              title: "Quick duplicate this purchase order?",
              message:
                "This will create a new purchase order based on the current one. Any unsaved changes made here will be lost.",
              stayText: "Cancel",
              leaveText: "Confirm",
              onConfirm: handleQuickDuplicate,
            });
          }}
        >
          Quick Duplicate
        </MenuItem>

        <MenuItem
          disabled={finalizationController.disableFields || everythingDisabled}
          onClick={() => {
            closeDuplicateMenu();

            openRedirectWarning({
              title: "Create a custom duplicate?",
              message:
                "Do you want to create a custom duplicate of this purchase order? Clicking 'Confirm' will redirect you to a page where you can choose what to copy. Any unsaved changes made here will be lost.",
              stayText: "Cancel",
              leaveText: "Confirm",
              onConfirm: handleCustomDuplicate,
            });
          }}
        >
          Custom Duplicate
        </MenuItem>
      </Menu> */}

      {/* More Actions menu */}
      <Menu
        anchorEl={moreActionsAnchorEl}
        open={moreActionsMenuOpen}
        onClose={closeMoreActionsMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          disabled={finalizationController.disableFields || everythingDisabled}
          onClick={() => {
            closeMoreActionsMenu();

            openRedirectWarning({
              title: "Close this purchase order?",
              message:
                "Do you want to change this purchase order’s status to 'Closed'? Closing a purchase order makes it read-only and it can no longer be edited. Any unsaved changes made here will be lost.",
              stayText: "Cancel",
              leaveText: "Confirm",
              onConfirm: handleClosePurchaseOrder,
            });
          }}
        >
          <ListItemIcon>
            <CloseIcon fontSize="small" />
          </ListItemIcon>
          Close Purchase Order
        </MenuItem>

        {!isAddPage && !isDraftPo && (
          String(poStatus || "").trim() === "On Hold" ? (
            <MenuItem
              disabled={finalizationController.disableFields || everythingDisabled}
              onClick={() => {
                closeMoreActionsMenu();

                openRedirectWarning({
                  title: "Open this purchase order?",
                  message:
                    "Do you want to change this purchase order’s status to 'Open'? Any unsaved changes made here will be lost.",
                  stayText: "Cancel",
                  leaveText: "Confirm",
                  onConfirm: handleOpenPurchaseOrder,
                });
              }}
            >
              <ListItemIcon>
                <PlayCircleOutlineIcon fontSize="small" />
              </ListItemIcon>
              Open Purchase Order
            </MenuItem>
          ) : (
            <MenuItem
              disabled={finalizationController.disableFields || everythingDisabled}
              onClick={() => {
                closeMoreActionsMenu();

                openRedirectWarning({
                  title: "Place this purchase order on hold?",
                  message:
                    "Do you want to change this purchase order’s status to 'On Hold'? Any unsaved changes made here will be lost.",
                  stayText: "Cancel",
                  leaveText: "Confirm",
                  onConfirm: handlePlaceOnHold,
                });
              }}
            >
              <ListItemIcon>
                <PauseCircleOutlineIcon fontSize="small" />
              </ListItemIcon>
              Place PO On Hold
            </MenuItem>
          )
        )}

        {!isAddPage && !isDraftPo && (
          <MenuItem
            disabled={finalizationController.disableFields || everythingDisabled}
            onClick={() => {
              closeMoreActionsMenu();
              onClickExportPDF();
            }}
          >
            <ListItemIcon>
              <FileDownloadIcon fontSize="small" />
            </ListItemIcon>
            Export To PDF
          </MenuItem>
        )}
      </Menu>

      {/* Save PO Menu */}
      {isDraftPo && (
        <Menu
          anchorEl={saveMenuAnchorEl}
          open={saveMenuOpen}
          onClose={closeSaveMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem
            disabled={finalizationController.disableFields || everythingDisabled}
            onClick={() => {
              closeSaveMenu();
              updateDraft();
            }}
          >
            Update Draft
          </MenuItem>

          <MenuItem
            disabled={finalizationController.disableFields || everythingDisabled}
            onClick={() => {
              closeSaveMenu();
              createOfficialPo();
            }}
          >
            Create PO
          </MenuItem>
        </Menu>
      )}

      {/* Is PO Complete/Cancelled info snackbar. */}
      <Snackbar
        open={viewOnlySnackOpen}
        autoHideDuration={60000}
        onClose={() => setViewOnlySnackOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setViewOnlySnackOpen(false)}
          severity="info"
          sx={{ width: "100%" }}
        >
          {viewOnlySnackMsg}
        </Alert>
      </Snackbar>

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
  pageType: PropTypes.oneOf(["Add", "Edit", "Draft", "Duplicate"]),
  setNavbarActions: PropTypes.func,
};

export default ManagePurchaseOrder;