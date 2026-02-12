//General Use Imports
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";

//MUI Imports
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

//Custom Imports
import WORLD_COUNTRIES from "../../utils/Countries/WORLD_COUNTRIES";

// Match your DB column sizes
const charLimits = {
  name: 255,
  address: 255,
  aptSuite: 255,
  city: 255,
  state: 255,
  zipCode: 255,
  country: 255,
  phoneNumber1: 100,
  email1: 255,
  repFirstName: 255,
  repLastName: 255,
};

const emptyValues = {
  name: "",
  country: "US",
  address: "",
  aptSuite: "",
  city: "",
  state: "",
  zipCode: "",
  email1: "",
  phoneNumber1: "",
  repFirstName: "",
  repLastName: "",
};

function QuickCreateVendorComponent({
  open,
  onClose,
  onCreated,
}) {
  const [values, setValues] = useState(emptyValues);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const contactName = useMemo(() => {
    const f = values.repFirstName || "";
    const l = values.repLastName || "";
    return `${f}${f && l ? " " : ""}${l}`.trim();
  }, [values.repFirstName, values.repLastName]);

  useEffect(() => {
    if (!open) return;
    setValues(emptyValues);
    setErrors({});
    setSaveError("");
    setSaving(false);
  }, [open]);

  const setField = (name, next) => {
    const limit = charLimits[name];
    const capped =
      typeof next === "string" && typeof limit === "number"
        ? next.slice(0, limit)
        : next;

    setValues((prev) => ({ ...prev, [name]: capped }));

    setErrors((prev) => {
      if (!prev[name]) return prev;
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const validate = () => {
    const nextErrors = {};

    if (!String(values.name || "").trim()) nextErrors.name = "Vendor name is required";
    if (!String(values.country || "").trim()) nextErrors.country = "Country/region is required";

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    setSaveError("");

    if (!validate()) return;

    setSaving(true);
    try {
      const pk =
        (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
        (() => {
          // fallback: 16 bytes -> hex string
          const bytes = new Uint8Array(16);
          globalThis.crypto.getRandomValues(bytes);
          return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        })();

      const createdVendor = {
        pk,
        name: String(values.name || "").trim(),
        address: values.address || "",
        aptSuite: values.aptSuite || "",
        city: values.city || "",
        state: values.state || "",
        zipCode: values.zipCode || "",
        phoneNumber1: values.phoneNumber1 || "",
        faxNumber1: "",
        email1: values.email1 || "",
        website: "",
        account: "",
        repFirstName: values.repFirstName || "",
        repLastName: values.repLastName || "",
        repTitle: "",
        repOfficePhoneNumber: "",
        repCellPhoneNumber: "",
        repEmail: "",
        notes: "",
        country: values.country || "US",
      };

      onCreated?.(createdVendor);
      onClose?.();
    } catch (e) {
      setSaveError(e?.message || "Failed to create vendor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflowX: "hidden",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <Typography sx={{ fontWeight: 700 }}>Create Vendor</Typography>
        <IconButton
          onClick={onClose}
          disabled={saving}
          size="small"
          aria-label="Close"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box
          sx={{
            maxHeight: { xs: "60vh", sm: "65vh" },
            overflowY: "auto",
            overflowX: "hidden",
            p: 2,
          }}
        >
          {saveError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {saveError}
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                fullWidth
                label={
                  <>
                    Vendor name<span style={{ color: "red" }}> *</span>
                  </>
                }
                value={values.name}
                onChange={(e) => setField("name", e.target.value)}
                error={!!errors.name}
                helperText={errors.name}
                inputProps={{ maxLength: charLimits.name }}
              />
            </Grid>

            <Grid size={12}>
              <Autocomplete
                options={WORLD_COUNTRIES}
                value={
                  WORLD_COUNTRIES.find((c) => c.value === values.country) || null
                }
                onChange={(_, option) => setField("country", option?.value || "")}
                disableClearable={false} // ✅ must pick; can clear but validation will block save
                fullWidth
                getOptionLabel={(option) => option?.label || ""}
                isOptionEqualToValue={(option, value) => option.value === value.value}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={
                      <>
                        Country/region<span style={{ color: "red" }}> *</span>
                      </>
                    }
                    fullWidth
                    error={!!errors.country}
                    helperText={errors.country}
                  />
                )}
              />
            </Grid>

            <Grid size={12}>
              <TextField
                fullWidth
                label="Address"
                value={values.address}
                onChange={(e) => setField("address", e.target.value)}
                inputProps={{ maxLength: charLimits.address }}
              />
            </Grid>

            <Grid size={12}>
              <TextField
                fullWidth
                label="Apartment, suite, etc"
                value={values.aptSuite}
                onChange={(e) => setField("aptSuite", e.target.value)}
                inputProps={{ maxLength: charLimits.aptSuite }}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="City"
                value={values.city}
                onChange={(e) => setField("city", e.target.value)}
                inputProps={{ maxLength: charLimits.city }}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="State"
                value={values.state}
                onChange={(e) => setField("state", e.target.value)}
                inputProps={{ maxLength: charLimits.state }}
              />
            </Grid>

            <Grid size={12}>
              <TextField
                fullWidth
                label="ZIP code"
                value={values.zipCode}
                onChange={(e) => setField("zipCode", e.target.value)}
                inputProps={{ maxLength: charLimits.zipCode }}
              />
            </Grid>

            <Grid size={12}>
              <TextField
                fullWidth
                label="Contact name"
                value={contactName}
                onChange={(e) => {
                  const v = (e.target.value || "").slice(
                    0,
                    (charLimits.repFirstName || 255) + (charLimits.repLastName || 255)
                  );
                  const parts = v.trim().split(/\s+/);
                  const first = (parts.shift() || "").slice(0, charLimits.repFirstName);
                  const last = (parts.join(" ") || "").slice(0, charLimits.repLastName);
                  setValues((prev) => ({ ...prev, repFirstName: first, repLastName: last }));
                }}
                inputProps={{
                  maxLength:
                    (charLimits.repFirstName || 255) + (charLimits.repLastName || 255),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Email address"
                value={values.email1}
                onChange={(e) => setField("email1", e.target.value)}
                inputProps={{ maxLength: charLimits.email1 }}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Phone number"
                value={values.phoneNumber1}
                onChange={(e) => setField("phoneNumber1", e.target.value)}
                inputProps={{ maxLength: charLimits.phoneNumber1 }}
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          px: 2,
          py: 1.5,
          borderTop: "1px solid",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <Button onClick={onClose} disabled={saving} variant="outlined" color="inherit">
          Close
        </Button>
        <Button onClick={handleSave} disabled={saving} variant="contained">
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

QuickCreateVendorComponent.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
  darkMode: PropTypes.bool,
};

export default QuickCreateVendorComponent;