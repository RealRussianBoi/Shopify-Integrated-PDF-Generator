//General Use Imports
import PropTypes from "prop-types";
import { Controller } from "react-hook-form";
import { useMemo, useState, useRef } from "react";

//MUI Imports
import { Grid, MenuItem, Select, TextField, InputAdornment } from "@mui/material";

//Custom Imports
import { useTheme } from "../../context/ThemeContext";

// Postgres INT max
const PG_INT_MAX = 2147483647;

function PriceAugmentComponent({
  control,
  setValue,
  defaultValues = {
    discountPercent: 0,
    discountAmount: 0,
    freight: 0,
    fee: 0,
  },
  everythingDisabled = false,
  hideFields = [],
}) {
  const { darkMode } = useTheme();

  const initialSymbol = useMemo(() => {
    const amt = Number(defaultValues?.discountAmount || 0);
    const pct = Number(defaultValues?.discountPercent || 0);
    return amt > 0 ? "$" : pct > 0 ? "%" : "%";
  }, [defaultValues]);

  const initialDiscountValue = useMemo(() => {
    const amt = Number(defaultValues?.discountAmount || 0);
    const pct = Number(defaultValues?.discountPercent || 0);
    return amt > 0 ? amt : pct > 0 ? pct : 0;
  }, [defaultValues]);

  const [discountSymbol, setDiscountSymbol] = useState(initialSymbol);
  const discountEditingRef = useRef(false);

  const hidden = useMemo(() => {
    const normalized = Array.isArray(hideFields)
      ? hideFields
      : String(hideFields || "").split(",");
    return new Set(
      normalized.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    );
  }, [hideFields]);

  const isHidden = (name) => hidden.has(String(name).trim().toLowerCase());

  // When some fields are hidden, let the remaining visible fields expand to fill space.
  const itemSx = {
    flex: "1 1 220px",
    minWidth: { xs: "100%", sm: 220 },
  };

  // -----------------------------
  // Helpers: 4dp + empty -> 0 on blur + clamp to PG_INT_MAX for non-% fields
  // -----------------------------
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const to4 = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 10000) / 10000;
  };

  const toMoney = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return to4(clamp(x, 0, PG_INT_MAX));
  };

  const applyMoneyOnBlur = (name) => (e) => {
    const raw = String(e?.target?.value ?? "");
    const parsed = raw.trim() ? parseFloat(raw) : 0;
    const next = toMoney(parsed);

    setValue(name, next, { shouldDirty: true, shouldValidate: true });
  };

  const handleDiscountTypeChange = (symbol) => {
    setDiscountSymbol(symbol);

    // Reset all discount fields when switching modes
    setValue("discountPercent", 0, { shouldDirty: true, shouldValidate: true });
    setValue("discountAmount", 0, { shouldDirty: true, shouldValidate: true });
    setValue("discountValue", 0, { shouldDirty: true, shouldValidate: true });
  };

  const handleDiscountBlur = (rawValue) => {
    const raw = String(rawValue ?? "");
    const parsed = raw.trim() ? parseFloat(raw) : 0;
    const v = Number.isFinite(parsed) ? parsed : 0;

    if (discountSymbol === "%") {
      const pct = to4(v);
      setValue("discountPercent", pct, { shouldDirty: true, shouldValidate: true });
      setValue("discountAmount", 0, { shouldDirty: true, shouldValidate: true });
      setValue("discountValue", pct, { shouldDirty: true, shouldValidate: true });
      return;
    }

    const money = toMoney(v);
    setValue("discountAmount", money, { shouldDirty: true, shouldValidate: true });
    setValue("discountPercent", 0, { shouldDirty: true, shouldValidate: true });
    setValue("discountValue", money, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Grid
      container
      spacing={1}
      justifyContent="flex-start"
      sx={{
        mt: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
      }}
    >
      {!isHidden("discount") && (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} sx={itemSx}>
          <Controller
            name="discountValue"
            control={control}
            defaultValue={initialDiscountValue}
            rules={{
              validate: (value) => {
                const v = parseFloat(value);
                if (isNaN(v)) return true;
                if (v < 0) return "Value cannot be negative";
                if (discountSymbol === "%" && v > 100) return "Percentage cannot exceed 100%";
                if (discountSymbol === "$" && v > PG_INT_MAX) return `Value cannot exceed ${PG_INT_MAX}`;
                return true;
              },
            }}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                fullWidth
                label="Discount"
                type="number"
                variant={everythingDisabled ? "filled" : "outlined"}
                disabled={everythingDisabled}
                value={field.value ?? 0}
                error={!!error}
                helperText={error?.message}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Select
                        value={discountSymbol}
                        onChange={(e) => handleDiscountTypeChange(e.target.value)}
                        variant="standard"
                        disableUnderline
                        disabled={everythingDisabled}
                        sx={{
                          minWidth: 34,
                          border: "1px solid",
                          borderColor: darkMode ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)",
                          borderRadius: 1,
                          px: 0.5,
                        }}
                      >
                        <MenuItem value="%">%</MenuItem>
                        <MenuItem value="$">$</MenuItem>
                      </Select>
                    </InputAdornment>
                  ),
                }}
                onChange={(e) => {
                  field.onChange(e.target.value);
                }}
                onBlur={() => {
                  discountEditingRef.current = false;
                  handleDiscountBlur(field.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => {
                  discountEditingRef.current = true;
                  e.target.select();
                }}
                onWheel={(e) => e.target.blur()}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("freight") && (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} sx={itemSx}>
          <Controller
            name="freight"
            control={control}
            defaultValue={toMoney(defaultValues.freight || 0)}
            rules={{
              validate: (value) => {
                const v = parseFloat(value);
                if (isNaN(v)) return true;
                if (v < 0) return "Value cannot be negative";
                if (v > PG_INT_MAX) return `Value cannot exceed ${PG_INT_MAX}`;
                return true;
              },
            }}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                fullWidth
                label="Freight"
                type="number"
                variant={everythingDisabled ? "filled" : "outlined"}
                disabled={everythingDisabled}
                value={field.value ?? 0}
                error={!!error}
                helperText={error?.message}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
                onChange={(e) => {
                  field.onChange(e.target.value); // no setValue here
                }}
                onBlur={applyMoneyOnBlur("freight")} // setValue + shouldValidate happens once here
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => e.target.select()}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("fee") && (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} sx={itemSx}>
          <Controller
            name="fee"
            control={control}
            defaultValue={toMoney(defaultValues.fee || 0)}
            rules={{
              validate: (value) => {
                const v = parseFloat(value);
                if (isNaN(v)) return true;
                if (v < 0) return "Value cannot be negative";
                if (v > PG_INT_MAX) return `Value cannot exceed ${PG_INT_MAX}`;
                return true;
              },
            }}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                fullWidth
                label="Fee"
                type="number"
                variant={everythingDisabled ? "filled" : "outlined"}
                disabled={everythingDisabled}
                value={field.value ?? 0}
                error={!!error}
                helperText={error?.message}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
                onChange={(e) => {
                  field.onChange(e.target.value); // no setValue here
                }}
                onBlur={applyMoneyOnBlur("fee")}
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => e.target.select()}
              />
            )}
          />
        </Grid>
      )}
    </Grid>
  );
}

PriceAugmentComponent.propTypes = {
  control: PropTypes.object.isRequired,
  setValue: PropTypes.func.isRequired,
  defaultValues: PropTypes.object,
  everythingDisabled: PropTypes.bool,
  hideFields: PropTypes.oneOfType([PropTypes.string, PropTypes.arrayOf(PropTypes.string)]),
};

export default PriceAugmentComponent;