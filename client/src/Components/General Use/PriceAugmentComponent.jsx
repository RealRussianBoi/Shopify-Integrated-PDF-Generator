//General Use Imports
import PropTypes from "prop-types";
import { Controller } from "react-hook-form";
import { useEffect, useMemo, useState, useRef } from "react";

//MUI Imports
import { Grid, MenuItem, Select, TextField, InputAdornment } from "@mui/material";

//Custom Imports
import { useTheme } from "../../context/ThemeContext";

// Postgres INT max
const PG_INT_MAX = 2147483647;

function PriceAugmentComponent({
  control,
  setValue,
  getValues,
  trigger,
  watch,
  rowsToMonitor,
  defaultValues = {
    discountPercent: 0,
    discountAmount: 0,
    freight: 0,
    fee: 0,
    tax: 0,
  },
  paramToMonitor,
  everythingDisabled = false,
  hideFields = [],
}) {
  const { darkMode } = useTheme();
  const [discountSymbol, setDiscountSymbol] = useState("%");

  // ✅ prevents loaded/reset values from overriding the user while they are editing the discount field
  const discountEditingRef = useRef(false);

  const hidden = useMemo(() => {
    // Accept either an array or a comma-separated string.
    const normalized = Array.isArray(hideFields)
      ? hideFields
      : String(hideFields || "").split(",");

    return new Set(
      normalized
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );
  }, [hideFields]);

  const isHidden = (name) => hidden.has(String(name).trim().toLowerCase());

  // When some fields are hidden, let the remaining visible fields expand to fill space.
  // This uses flexbox sizing instead of fixed Grid column widths.
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
    // Non-percentage numeric fields: clamp to [0, PG_INT_MAX] and 4 decimals
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return to4(clamp(x, 0, PG_INT_MAX));
  };

  const applyMoneyOnBlur = (name) => (e) => {
    const raw = String(e?.target?.value ?? "");
    if (!raw.trim()) {
      setValue(name, 0);
      trigger(name);
      calcTotal(name);
      return;
    }

    const parsed = parseFloat(raw);
    const next = toMoney(parsed);

    setValue(name, next);
    trigger(name);
    calcTotal(name);
  };

  // ---------------------------------------
  // ✅ Sync discount symbol/value when data loads (or reset() runs)
  // ---------------------------------------
  const discountPercentWatch = watch("discountPercent");
  const discountAmountWatch = watch("discountAmount");

  useEffect(() => {
    if (discountEditingRef.current) return;

    const pct = Number(discountPercentWatch) || 0;
    const amt = Number(discountAmountWatch) || 0;

    // Amount wins if non-zero; otherwise percent; otherwise default to %
    const nextSymbol = amt > 0 ? "$" : "%";
    const nextValue = amt > 0 ? toMoney(amt) : to4(pct);

    setDiscountSymbol((prev) => (prev === nextSymbol ? prev : nextSymbol));

    const currentValue = Number(getValues("discountValue") || 0);
    if (to4(currentValue) !== to4(nextValue)) {
      setValue("discountValue", nextValue, { shouldDirty: false, shouldValidate: true });
      trigger("discountValue");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountPercentWatch, discountAmountWatch]);

  useEffect(() => {
    setValue("subtotal", 0);
    setValue("total", 0);

    setValue("discountPercent", defaultValues.discountPercent || 0);
    setValue("discountAmount", toMoney(defaultValues.discountAmount || 0));
    setValue("freight", toMoney(defaultValues.freight || 0));
    setValue("fee", toMoney(defaultValues.fee || 0));
    setValue("tax", toMoney(defaultValues.tax || 0));

    const initialDiscountValue =
      parseFloat(defaultValues.discountAmount) > 0
        ? parseFloat(defaultValues.discountAmount)
        : parseFloat(defaultValues.discountPercent) > 0
          ? parseFloat(defaultValues.discountPercent)
          : 0;

    setValue(
      "discountValue",
      defaultValues.discountPercent != 0 ? initialDiscountValue : toMoney(initialDiscountValue)
    );

    setDiscountSymbol(
      defaultValues.discountPercent != 0 ? "%" : defaultValues.discountAmount != 0 ? "$" : "%"
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    trigger("discountValue");
  }, [watch("subtotal")]);

  const calcTotal = (name) => {
    const names = ["subtotal", "discountPercent", "discountAmount", "freight", "fee", "tax"];
    const additionalCosts = getValues(names);

    const subtotal = parseFloat(additionalCosts[0]) || 0;
    const discountPercent = parseFloat(additionalCosts[1]) || 0; // %
    const discountAmount = parseFloat(additionalCosts[2]) || 0; // $
    const freight = parseFloat(additionalCosts[3]) || 0;
    const fee = parseFloat(additionalCosts[4]) || 0;
    const tax = parseFloat(additionalCosts[5]) || 0;

    let total = subtotal;

    total -= total * (discountPercent / 100);
    total -= discountAmount;
    total += freight;
    total += fee;
    total += tax;

    total = toMoney(total);
    setValue("total", total);

    if (name) trigger(name);
  };

  const handleDiscountTypeChange = (symbol) => {
    setDiscountSymbol(symbol);

    setValue("discountAmount", 0);
    setValue("discountPercent", 0);
    setValue("discountValue", 0);

    trigger("discountValue");
    calcTotal();
  };

  const handleBlur = () => {
    const raw = String(getValues("discountValue") ?? "");
    if (!raw.trim()) {
      setValue("discountValue", 0);
      setValue("discountPercent", 0);
      setValue("discountAmount", 0);
      trigger("discountValue");
      calcTotal();
      return;
    }

    const parsed = parseFloat(raw);
    const v = Number.isFinite(parsed) ? parsed : 0;

    if (discountSymbol === "%") {
      // percentage: keep as-is (validation already caps at 100)
      setValue("discountPercent", v);
      setValue("discountAmount", 0);
    } else {
      // money: clamp to PG_INT_MAX and 4dp
      const money = toMoney(v);
      setValue("discountAmount", money);
      setValue("discountPercent", 0);
      setValue("discountValue", money);
    }

    trigger("discountValue");
    calcTotal();
  };

  useEffect(() => {
    const rows = Array.isArray(rowsToMonitor) ? rowsToMonitor : [];
    const nextSubtotal =
      rows.length > 0
        ? rows.reduce((acc, cur) => acc + (parseFloat(cur?.[paramToMonitor]) || 0), 0)
        : 0;

    setValue("subtotal", toMoney(nextSubtotal));
    calcTotal();
  }, [rowsToMonitor]);

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
      {!isHidden("subtotal") && (
        <Grid item sx={itemSx}>
          <Controller
            name="subtotal"
            control={control}
            defaultValue={0}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                label="Subtotal"
                variant="filled"
                value={watch("subtotal") || 0}
                disabled
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("discount") && (
        <Grid item sx={itemSx}>
          <Controller
            name="discountValue"
            control={control}
            defaultValue={0}
            rules={{
              validate: (value) => {
                const v = parseFloat(value);
                if (isNaN(v)) return true;
                if (v < 0) return "Value cannot be negative";
                if (discountSymbol === "%" && v > 100) return "Percentage cannot exceed 100%";
                if (discountSymbol === "$") {
                  const sub = parseFloat(getValues("subtotal") || 0);
                  if (v > sub) return "Discount amount cannot exceed subtotal";
                  if (v > PG_INT_MAX) return `Value cannot exceed ${PG_INT_MAX}`;
                }
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
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => {
                  discountEditingRef.current = true;
                  e.target.select();
                }}
                onBlur={() => {
                  discountEditingRef.current = false;
                  handleBlur();
                }}
                onWheel={(e) => e.target.blur()}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("freight") && (
        <Grid item sx={itemSx}>
          <Controller
            name="freight"
            control={control}
            defaultValue={defaultValues.freight || 0}
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
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => e.target.select()}
                onBlur={applyMoneyOnBlur("freight")}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("fee") && (
        <Grid item sx={itemSx}>
          <Controller
            name="fee"
            control={control}
            defaultValue={defaultValues.fee || 0}
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
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => e.target.select()}
                onBlur={applyMoneyOnBlur("fee")}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("tax") && (
        <Grid item sx={itemSx}>
          <Controller
            name="tax"
            control={control}
            defaultValue={defaultValues.tax || 0}
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
                label="Tax"
                type="number"
                variant={everythingDisabled ? "filled" : "outlined"}
                disabled={everythingDisabled}
                value={field.value ?? 0}
                error={!!error}
                helperText={error?.message}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "Minus") e.preventDefault();
                }}
                onFocus={(e) => e.target.select()}
                onBlur={applyMoneyOnBlur("tax")}
              />
            )}
          />
        </Grid>
      )}

      {!isHidden("total") && (
        <Grid item sx={itemSx}>
          <Controller
            name="total"
            control={control}
            defaultValue={0}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                label="Total"
                variant="filled"
                value={watch("total") || 0}
                disabled
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
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
  getValues: PropTypes.func.isRequired,
  trigger: PropTypes.func.isRequired,
  watch: PropTypes.func.isRequired,
  rowsToMonitor: PropTypes.array.isRequired,
  defaultValues: PropTypes.object,
  paramToMonitor: PropTypes.string.isRequired,
  everythingDisabled: PropTypes.bool,
  hideFields: PropTypes.oneOfType([PropTypes.string, PropTypes.arrayOf(PropTypes.string)]),
};

export default PriceAugmentComponent;