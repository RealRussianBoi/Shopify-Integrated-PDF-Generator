//General use imports.
import axios from "axios";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Controller, useForm } from "react-hook-form";

//MUI imports.
import { Alert, Autocomplete, Box, Button, Chip,
  Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormHelperText, Grid, IconButton,
  MenuItem, Select, TextField, Typography, 
  useMediaQuery as useMuiMediaQuery, useTheme as useMuiTheme, } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { DataGrid, GridActionsCellItem, useGridApiRef, GridEditInputCell, } from "@mui/x-data-grid";
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

    const toMidnight = (v) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const ship = toMidnight(dateToShipWatch);
    const due = toMidnight(dueDateWatch);
    const voidD = toMidnight(dateVoidWatch);

    if (ship && due && due < ship) warnings.push("Due Date is earlier than Date To Ship.");
    if (voidD) {
      if (ship && voidD < ship) warnings.push("Date Void is earlier than Date To Ship.");
      if (due && voidD < due) warnings.push("Date Void is earlier than Due Date.");
    }

    if (warningFutureDate) {
      const isFiveYearsOutOrMore = (d) => d && d >= warningFutureDate;
      if (isFiveYearsOutOrMore(ship) || isFiveYearsOutOrMore(due) || isFiveYearsOutOrMore(voidD)) {
        warnings.push("One or more dates are 5+ years in the future.");
      }
    }

    return warnings;
  }, [dueDateWatch, dateToShipWatch, dateVoidWatch, warningFutureDate]);
  
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
  // Totals / Summary
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

  const roundTo = (n, places = 4) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const p = 10 ** places;
    return Math.round(x * p) / p;
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

  const discountPercent = watch("discountPercent");
  const discountAmount  = watch("discountAmount");
  const freight         = watch("freight");
  const fee             = watch("fee");

  const summaryCalc = useMemo(() => {
    const dp = money(discountPercent);
    const da = money(discountAmount);
    const fr = money(freight);
    const fe = money(fee);

    const percentDiscountValue = roundTo(tableSubtotal * (dp / 100), 4);
    const netAdditional = roundTo(-percentDiscountValue - da + fr + fe, 4);
    const tableTotal = roundTo(tableSubtotal + netAdditional, 4);

    return { dp, da, fr, fe, percentDiscountValue, netAdditional, tableTotal };
  }, [tableSubtotal, discountPercent, discountAmount, freight, fee]);

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

  const handleResetFields = useCallback(() => {
    reset(defaultValues);
    setTableRows([]);
    clearErrors();
  }, [reset, defaultValues, clearErrors]);

  const validateCreatePO = useCallback(async () => {
    setFinalDialog((prev) => ({
      ...prev,
      open: true,
      loadingText: "Saving Purchase Order...",
      severity: "info",
      severityText: "",
    }));

    // Give React time to render dialog before heavy work
    await new Promise((resolve) => setTimeout(resolve, 0));
    
    const formData = getValues();

    const headerIssues = [];
    const rowIssues = [];

    const vendorPk = String(formData?.vendorPk ?? "").trim();
    const destinationPk = String(formData?.destinationPk ?? "").trim();
    const poNumber = String(formData?.poNumber ?? "").trim();

    if (!vendorPk) {
      headerIssues.push("Vendor is required.");
      setError("vendorPk", { type: "manual", message: "Vendor is required." });
    } else {
      clearErrors("vendorPk");
    }

    if (!destinationPk) {
      headerIssues.push("Destination is required.");
      setError("destinationPk", { type: "manual", message: "Destination is required." });
    } else {
      clearErrors("destinationPk");
    }

    if (!poNumber) {
      headerIssues.push("PO Number is required.");
      setError("poNumber", { type: "manual", message: "PO Number is required." });
    } else {
      clearErrors("poNumber");
    }

    const rows = Array.isArray(tableRows) ? tableRows : [];

    if (rows.length === 0) {
      rowIssues.push("Add at least one product to the PO.");
    } else {
      rows.forEach((r) => {
        const uid = r?.uid ?? "?";
        const desc = String(r?.variantDescriptionPurchase ?? "").trim();
        if (!desc) rowIssues.push(`Row ${uid}: Purchase Description is required.`);
      });
    }

    const uniqueRowIssues = [...new Set(rowIssues)];

    if (uniqueRowIssues.length) {
      setError("rows", { type: "manual", message: uniqueRowIssues.join("\n") });
    } else {
      clearErrors("rows");
    }

    const allIssues = [...headerIssues, ...uniqueRowIssues];

    if (allIssues.length) {
      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "error",
        loadingText: "",
        severityText: (
          <Box
            sx={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontWeight: 800 }}>Cannot export PDF. Fix:</Typography>

            <Box sx={{ width: "100%", maxWidth: 520 }}>
              {allIssues.slice(0, 8).map((msg, i) => (
                <Typography key={i} variant="body2" sx={{ lineHeight: 1.4 }}>
                  {msg}
                </Typography>
              ))}

              {allIssues.length > 8 && (
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>
                  (+{allIssues.length - 8} more)
                </Typography>
              )}
            </Box>
          </Box>
        ),
      }));

      return false;
    }

    return true;
  }, [getValues, tableRows, setError, clearErrors, setFinalDialog]);

  const handleExportToPdf = useCallback(async () => {
    const ok = validateCreatePO();
    if (!ok) return;

    const formData = getValues();

    const vendor =
      vendorsList.find((v) => String(v.pk) === String(formData.vendorPk)) || null;

    const destination =
      destinationsList.find((d) => String(d.pk) === String(formData.destinationPk)) || null;

    const payload = {
      poNumber: String(formData.poNumber || "").trim(),
      dates: {
        dateToShip: formData.dateToShip ? new Date(formData.dateToShip).toISOString() : null,
        dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
        dateVoid: formData.dateVoid ? new Date(formData.dateVoid).toISOString() : null,

        paymentTerms: String(formData.paymentTerms || "").trim(),
        shippingCarrier: String(formData.shippingCarrier || "").trim(),
        trackingNumber: String(formData.trackingNumber || "").trim(),
      },

      billingAddress: {
        companyName: "Summit Snowboards",
        line1: "123 Demo St",
        line2: "",
        city: "New York",
        region: "NY",
        postal_code: "10001",
        country_code: "US",
        phone: "555-555-5555",
        email: "demo@syncbooks.com",
        website: "syncbooks.example",
      },

      shippingAddress: destination
        ? {
            line1: destination.addressLine1 || "",
            line2: destination.addressLine2 || "",
            city: destination.addressCity || "",
            region: destination.addressRegion || "",
            postal_code: destination.addressPostalCode || "",
            country_code: destination.addressCountryCode || "US",
            phone: destination.phone || "",
            email: destination.email || "",
          }
        : null,

      vendor: vendor
        ? {
            pk: vendor.pk,
            name: vendor.name || "",
            address: vendor.address || "",
            aptSuite: vendor.aptSuite || "",
            city: vendor.city || "",
            state: vendor.state || "",
            zipCode: vendor.zipCode || "",
            country: vendor.country || "",
            phoneNumber1: vendor.phoneNumber1 || "",
            email1: vendor.email1 || "",
          }
        : null,

      rows: (Array.isArray(tableRows) ? tableRows : []).map((r) => ({
        uid: r.uid,
        headerImage: r.headerImage,
        variantSku: r.variantSku,
        variantDescriptionPurchase: r.variantDescriptionPurchase,
        qtyOrdered: r.qtyOrdered,
        cost: r.cost,
        variantTax: r.variantTax,
      })),

      summary: {
        subtotal: tableSubtotal,
        shipping: Number(getValues("freight") || 0),
        total: summaryCalc.tableTotal,
      },
    };

    try {
      const res = await axios.post(
        "https://shopify-integrated-pdf-generator.onrender.com/purchase-order/export/pdf",
        payload,
        { responseType: "blob" }
      );
    
      const disposition = res.headers?.["content-disposition"] || "";
      const match = /filename\*?=(?:UTF-8''|")?([^;"\n]+)/i.exec(disposition);
      const filenameFromHeader = match ? decodeURIComponent(match[1].replace(/"/g, "")) : null;
    
      const fallbackName = `Purchase Order ${payload.poNumber || "export"}.pdf`;
      const filename = filenameFromHeader || fallbackName;
    
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
    
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    
      window.URL.revokeObjectURL(url);

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "success",
        severityText: "Purchase Order saved successfully!",
      }));
    } catch (error) {
      console.error("Error exporting purchase order PDF:", error);

      setFinalDialog((prev) => ({
        ...prev,
        open: true,
        severity: "warning",
        severityText: `An error occurred while exporting the PDF. Please try again.\n\nError details: ${error.message}`,
      }));
    }
  }, [
    validateCreatePO,
    getValues,
    vendorsList,
    destinationsList,
    tableRows,
    tableSubtotal,
    summaryCalc.tableTotal,
  ]);

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
        const listsRes = await axios.get("https://shopify-integrated-pdf-generator.onrender.com/purchase-order/data-for-new");

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

  //Sets Navbar Actions
  useEffect(() => {
    setNavbarActions(
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
          width: "auto",
        }}
      >
        <Button
          variant="outlined"
          color="inherit"
          type="button"
          disabled={finalizationController.disableFields}
          onClick={handleResetFields}
        >
          Reset Fields
        </Button>

        <Button
          variant="contained"
          color="secondary"
          type="button"
          disabled={finalizationController.disableFields}
          startIcon={<FileDownloadIcon />}
          onClick={handleExportToPdf}
        >
          Export To PDF
        </Button>
      </Box>
    );

    return () => setNavbarActions(null);
  }, [
    setNavbarActions,
    finalizationController.disableFields,
    validateCreatePO,
  ]);

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
      const response = await axios.get("https://shopify-integrated-pdf-generator.onrender.com/purchase-order/get/item-data", {
        params: {
          selectedPks: selectedVariants.map((s) => s.variantPk), // Shopify variant GID
        },
      });

      const items = (response.data.items || []).map((r) => ({
        ...r,

        qtyOnHand: Number(r.qtyOnHand || 0),

        qtyOnOrder: 0,

        variantDescriptionPurchaseBaseline: String(r?.variantDescriptionPurchase ?? "").trim(),
      }));

      const updatedRows = handleUidAssign([...(Array.isArray(tableRows) ? tableRows : []), ...items]);
      setTableRows(updatedRows);
      clearErrors("rows");
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
    clearErrors("rows");
    return updatedRow;
  };

  const handleDeleteClick = useCallback((uid) => {
    setTableRows((prev) => {
      const updatedRows = [...prev];
      updatedRows.splice(uid - 1, 1);
      return handleUidAssign(updatedRows);
    });
  }, []);

  const openSampleRedirect = () => {
    openRedirectWarning({
      title: "Sample redirect confirmation",
      message:
        "This is a sample redirect confirmation. Clicking Confirm would normally redirect you elsewhere, but it won't in this single-page demo.",
      stayText: "Cancel",
      leaveText: "Confirm",
      onConfirm: () => {
        // Intentionally do nothing (demo)
      },
    });
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

  const columns = useMemo(() => ([
      {
        align: "left", 
        headerAlign: "left",
        headerName: "",
        field: "actions",
        type: "actions",
        width: 25,
        getActions: (params) => (
          <GridActionsCellItem
            key="delete-action"
            icon={<DeleteIcon />}
            onClick={() => handleDeleteClick(params.row.uid)}
            label="Delete"
            color="inherit"
          />
        )
      },
      {
        align: "left", 
        headerAlign: "left",
        field: "headerImage",
        headerName: "Image",
        width: 60,
        renderCell: (params) => (
          <img
            src={params.value}
            alt=""
            style={{ width: 42, height: 42, borderRadius: 6, marginTop: "5px" }}
          />
        ),
        sortable: false,
        filterable: false,
      },
      {
        align: "left", 
        headerAlign: "left",
        field: "variantTitle",
        headerName: "Title",
        width: 280,
        renderCell: (params) => {
          const variantTitle = params.value || "—";
          const productTitle = params.row?.productTitle || "";

          const showVariantChip =
            !!variantTitle &&
            variantTitle !== "—" &&
            String(variantTitle).toLowerCase() !== "default title" &&
            variantTitle !== productTitle;

          const handleClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSampleRedirect();
          };

          if (showVariantChip) {
            return (
              <Box
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleClick(e);
                }}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  overflow: "hidden",
                  cursor: "pointer",
                  "&:hover": { textDecoration: "underline" },
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
            <Box
              role="button"
              tabIndex={0}
              onClick={handleClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClick(e);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                height: "100%",
                minWidth: 0,
                cursor: "pointer",
                color: "primary.main",
                fontWeight: 600,
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {productTitle || variantTitle || "—"}
            </Box>
          );
        },
      },

      {
        align: "left", 
        headerAlign: "left",
        field: "variantSku",
        headerName: "SKU",
        width: 160,
        renderCell: (params) => {
          const sku = String(params.value || "").trim();
          return sku ? sku : "—";
        },
      },

      {
        align: "left", 
        headerAlign: "left",
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
        align: "left", 
        headerAlign: "left",
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
        align: "left",
        headerAlign: "left",
        field: "qtyOnHand",
        headerName: "Qty Available",
        width: 120,
        valueGetter: (v) => Number(v ?? 0)
      },

      withMobileIcons(
        {
          align: "left", 
          headerAlign: "left",
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

      {
        align: "left", 
        headerAlign: "left",
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
                const clamped = clampDecimalFromInput(e.target.value, {
                  min: 0,
                  max: 100,
                  fallback: 0,
                  places: 4,
                });
                params.api.setEditCellValue(
                  { id: params.id, field: params.field, value: clamped },
                  e
                );
              },
            }}
          />
        ),
      },

      {
        align: "left", 
        headerAlign: "left",
        field: "costExtended",
        headerName: "Extended Cost",
        width: 140,
        valueGetter: (v) => Number(v ?? 0),
        valueFormatter: (v) => `$${formatMoney(v ?? 0, 2)}`,
      }, 
    ]), 
  [
    isMobile,
    tableRows.length, // better than entire tableRows array (keeps columns more stable)
    handleDeleteClick,
  ]);

  //Prevents form submission from pressing enter button.
  const handlePressEnter = useCallback((event) => {
    if (event.key === "Enter") event.preventDefault();
  }, []);

  return (
    <Box className="page-responsive-width" sx={{ display: "flex", flexDirection: "column" }}>
      <LoadingAndFinalizationAlert
        visible={finalizationController.visible}
        loading={finalizationController.loading}
        severity={finalizationController.severity}
        finalResultText={finalizationController.finalResultText}
      />

      <form id="poForm" noValidate onKeyDown={handlePressEnter}>
        <Box
          sx={{
            "& > *": {
              bgcolor: "background.paper",
              borderRadius: 2,
              padding: 2,
              border: "1px solid",
              borderColor: "rgba(118, 118, 118, 0.57)",
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
                borderColor: "rgba(118, 118, 118, 0.57)",
                borderRadius: 2,
                p: 2,
                bgcolor: "background.paper",
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                PO Number
              </Typography>

              <Controller
                name="poNumber"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="PO Number"
                    variant="outlined"
                    disabled={finalizationController.disableFields}
                    value={field.value ?? ""}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || ""}
                    onChange={(e) => {
                      if (fieldState.error) clearErrors("poNumber");
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
                borderColor: "rgba(118, 118, 118, 0.57)",
                borderRadius: 2,
                p: 2,
                bgcolor: "background.paper",
              }}
            >
              <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                Shipment Dates
              </Typography>

              <Grid container spacing={2}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Controller
                      name="dueDate"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          {...field}
                          label="Due Date"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                          slotProps={{
                            textField: { fullWidth: true, size: "small" },
                          }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, md: 4 }}>
                    <Controller
                      name="dateToShip"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          {...field}
                          label="Date To Ship"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                          slotProps={{
                            textField: { fullWidth: true, size: "small" },
                          }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, md: 4 }}>
                    <Controller
                      name="dateVoid"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          {...field}
                          label="Date Void"
                          disabled={finalizationController.disableFields}
                          minDate={today}
                          slotProps={{
                            textField: { fullWidth: true, size: "small" },
                          }}
                        />
                      )}
                    />
                  </Grid>
                </LocalizationProvider>
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
                borderColor: "rgba(118, 118, 118, 0.57)",
                borderRadius: 2,
                overflow: "hidden",
                bgcolor: "background.paper",
              }}
            >
              <Grid container>
                {/* Vendor */}
                <Grid
                  size={{ xs: 12, md: 6 }}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid",
                    borderColor: "rgba(118, 118, 118, 0.57)",
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Vendor
                  </Typography>

                  <Controller
                    name="vendorPk"
                    control={control}
                    rules={{ required: "Vendor is required" }}
                    render={({ field, fieldState }) => (
                      <FormControl fullWidth error={!!fieldState.error}>
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

                            if (fieldState.error) clearErrors("vendorPk");
                            field.onChange(val);
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

                          {vendorsList.map((v) => {
                            const line2 = [v.city, v.state, v.zipCode].filter(Boolean).join(", ");
                            const addressTop = [v.address, v.aptSuite].filter(Boolean).join(v.aptSuite ? " " : "");
                            const addressFull = [addressTop, line2, v.country].filter(Boolean).join(" • ");

                            return (
                              <MenuItem
                                key={v.pk}
                                value={v.pk}
                                sx={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-start",
                                  py: 1.25,
                                }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                  {v.name}
                                </Typography>

                                <Typography
                                  variant="caption"
                                  sx={{
                                    mt: 0.25,
                                    color: "text.secondary",
                                    lineHeight: 1.2,
                                    whiteSpace: "normal",
                                  }}
                                >
                                  {addressFull || "—"}
                                </Typography>
                              </MenuItem>
                            );
                          })}
                        </Select>

                        {!!fieldState.error && (
                          <FormHelperText>{fieldState.error.message}</FormHelperText>
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
                    borderColor: "rgba(118, 118, 118, 0.57)",
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                    Destination
                  </Typography>

                  <Controller
                    name="destinationPk"
                    control={control}
                    rules={{ required: "Destination is required" }}
                    render={({ field, fieldState }) => (
                      <FormControl fullWidth error={!!fieldState.error}>
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
                          onChange={(e) => {
                            field.onChange(e.target.value);
                            if (fieldState.error) clearErrors("destinationPk");
                          }}
                        >
                          <MenuItem value="">
                            <em>Select destination</em>
                          </MenuItem>

                          {destinationsList.map((d) => {
                            const line2 = String(d.addressLine2 || "").trim();
                            const city = String(d.addressCity || "").trim();
                            const region = String(d.addressRegion || "").trim();
                            const postal = String(d.addressPostalCode || "").trim();
                            const country = String(d.addressCountryCode || "").trim();

                            const addressLineTop = [d.addressLine1, line2].filter(Boolean).join(line2 ? " " : "");
                            const addressLineBottom = [city, region, postal].filter(Boolean).join(", ");

                            const addressFull = [addressLineTop, addressLineBottom, country].filter(Boolean).join(" • ");

                            return (
                              <MenuItem
                                key={d.pk}
                                value={d.pk}
                                sx={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-start",
                                  py: 1.25,
                                }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                  {d.name}
                                </Typography>

                                <Typography
                                  variant="caption"
                                  sx={{
                                    mt: 0.25,
                                    color: "text.secondary",
                                    lineHeight: 1.2,
                                    whiteSpace: "normal",
                                  }}
                                >
                                  {addressFull || "—"}
                                </Typography>
                              </MenuItem>
                            );
                          })}
                        </Select>

                        {!!fieldState.error && (
                          <FormHelperText>{fieldState.error.message}</FormHelperText>
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
                    render={({ field, fieldState }) => {
                      const selected = WORLD_CURRENCIES.find((c) => c.value === field.value) || null;

                      return (
                        <FormControl fullWidth error={!!fieldState.error}>
                          <Autocomplete
                            options={WORLD_CURRENCIES}
                            value={selected}
                            onChange={(_, option) => field.onChange(option?.value || "")}
                            disabled={finalizationController.disableFields}
                            getOptionLabel={(option) =>
                              option?.label ? `${option.label} (${option.value})` : ""
                            }
                            isOptionEqualToValue={(option, value) => option.value === value.value}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                variant="outlined"
                                placeholder="Select currency"
                                error={!!fieldState.error}
                                helperText={fieldState.error?.message || ""}
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
                borderColor: !!errors.rows ? "error.main" : "rgba(118, 118, 118, 0.57)",
                height: "700px",
                overflow: "auto",
              }}
            >
              <DataGrid
                apiRef={apiRef}
                rows={tableRows}
                columns={columns}
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
              everythingDisabled={finalizationController.disableFields}
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
                    bgcolor: "background.paper",
                    borderRadius: 2,
                    padding: 2,
                    border: "1px solid",
                    borderColor: "rgba(118, 118, 118, 0.57)",
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
                    bgcolor: "background.paper",
                    borderRadius: 2,
                    padding: 2,
                    border: "1px solid",
                    borderColor: "rgba(118, 118, 118, 0.57)",
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