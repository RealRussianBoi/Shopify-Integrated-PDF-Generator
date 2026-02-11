//General use imports.
import axios from "axios";
import PropTypes from "prop-types";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

//MUI imports.
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  useMediaQuery as useMuiMediaQuery,
  useTheme as useMuiTheme,
} from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import ImageIcon from "@mui/icons-material/Image";
import SearchIcon from "@mui/icons-material/Search";

// react-virtualized
import { AutoSizer, List } from "react-virtualized";
import "react-virtualized/styles.css";

const formatAvailableQty = (n) => {
  const num = Number(n || 0);
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString();
};

const getVariantKey = (v) =>
  String(v?.variantPk ?? v?.pk ?? v?.shopifyVariantID ?? v?.shopifyVariantId ?? "");

const SEARCH_FIELDS = [
  { value: "productTitle", label: "Product title" },
  { value: "variantTitle", label: "Variant title" },
  { value: "sku", label: "SKU" },
];

const MemoSearchProductsBar = memo(function MemoSearchProductsBar({ disabled, onOpenWithSearch, searchLabel = "Search products" }) {
  const [text, setText] = useState("");

  const trigger = useCallback(() => {
    onOpenWithSearch(String(text || "").trim());
  }, [onOpenWithSearch, text]);

  return (
    <Grid container spacing={2} alignItems="center">
      <Grid item xs={12} md={10}>
        <TextField
          fullWidth
          label={searchLabel}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (disabled) return;
              trigger();
            }
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton aria-label="Search" disabled={disabled} onClick={trigger} sx={{ color: "warning.main" }}>
                  <SearchIcon />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Grid>

      <Grid item xs={12} md={2}>
        <Button fullWidth variant="outlined" color="warning" disabled={disabled} onClick={trigger}>
          Browse
        </Button>
      </Grid>
    </Grid>
  );
});

const MemoProductBrowserDialog = memo(function MemoProductBrowserDialog({
  open,
  companyPk,
  darkMode,
  disabled,
  initialSearch,
  onClose,
  onAddSelected,
}) {
  const muiTheme = useMuiTheme();
  const isLgDown = useMuiMediaQuery(muiTheme.breakpoints.down("lg"));
  const isMobileMd = useMuiMediaQuery(muiTheme.breakpoints.down("md"));

  const sectionBg = darkMode ? "#1e1e1e" : "#ffffff";

  const [forceFullScreen, setForceFullScreen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Keep filter typing local so it doesn't re-render the whole dialog tree on every keystroke.
  const [filterInput, setFilterInput] = useState("");
  const [searchField, setSearchField] = useState("productTitle");

  const activeSearchRef = useRef("");
  const activeSearchFieldRef = useRef("productTitle");

  // Products + pagination
  const [products, setProducts] = useState([]); // each product has variants[] (loaded)
  const [productOffset, setProductOffset] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);

  // Per-product variant loading state
  const loadingVariantsRef = useRef(new Map()); // productPk -> boolean
  const [, bumpVariantLoadingTick] = useState(0); // small tick to refresh buttons

  // Selection: Set in ref to reduce lag
  const checkedRef = useRef(new Set());
  const [checkedVersion, setCheckedVersion] = useState(0);
  const allSelectedProductsRef = useRef(new Set()); // productPk where ALL variants are selected (even unloaded)
  const unselectedInAllRef = useRef(new Map()); // productPk -> Set(variantKey) exceptions when all-selected

  // Sticky product header (current product in viewport)
  const [stickyProductPk, setStickyProductPk] = useState(null);

  // Reset when dialog opens / initialSearch changes
  useEffect(() => {
    if (!open) return;

    const preset = String(initialSearch || "").trim();
    setFilterInput(preset);
    activeSearchRef.current = preset;

    // default field on open
    setSearchField("productTitle");
    activeSearchFieldRef.current = "productTitle";

    checkedRef.current = new Set();
    setCheckedVersion((v) => v + 1);

    setProducts([]);
    setProductOffset(0);
    setHasMoreProducts(false);
    setStickyProductPk(null);

    setForceFullScreen(false);
    setFiltersOpen(true);

    (async () => {
      await fetchProductsPage({
        offset: 0,
        replace: true,
        search: preset,
        searchField: "productTitle",
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSearch]);

  const resetDialogState = useCallback(() => {
    setFilterInput("");
    setSearchField("productTitle");
    activeSearchRef.current = "";
    activeSearchFieldRef.current = "productTitle";

    checkedRef.current = new Set();
    allSelectedProductsRef.current = new Set();
    unselectedInAllRef.current = new Map();
    loadingVariantsRef.current = new Map();

    setCheckedVersion((v) => v + 1);

    setProducts([]);
    setProductOffset(0);
    setHasMoreProducts(false);
    setStickyProductPk(null);

    setForceFullScreen(false);
    setFiltersOpen(true);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDialogState();
    }
  }, [open, resetDialogState]);

  const getUnselectedSetForProduct = useCallback((productPk) => {
    const pk = String(productPk);
    let set = unselectedInAllRef.current.get(pk);
    if (!set) {
      set = new Set();
      unselectedInAllRef.current.set(pk, set);
    }
    return set;
  }, []);

  const anySelections = useMemo(() => {
    void checkedVersion;

    // Any individually checked variants?
    if (checkedRef.current.size > 0) return true;

    // Any "select all variants for product" selections?
    for (const pk of allSelectedProductsRef.current) {
      const p = products.find((x) => String(x.productPk) === String(pk));
      const total = Number(p?.variantTotal || 0);
      if (total <= 0) continue;

      const unselected = unselectedInAllRef.current.get(String(pk));
      const exceptionCount = unselected ? unselected.size : 0;

      // If total variants minus exceptions is > 0, something is selected
      if (total - exceptionCount > 0) return true;
    }

    return false;
  }, [checkedVersion, products]);

  const isVariantChecked = useCallback((productPk, variantKey) => {
    const pk = String(productPk);
    if (!variantKey) return false;

    if (allSelectedProductsRef.current.has(pk)) {
      const unselected = unselectedInAllRef.current.get(pk);
      return !unselected?.has(variantKey);
    }
    return checkedRef.current.has(variantKey);
  }, []);

  const toggleVariantKey = useCallback(
    (productPk, variantKey) => {
      if (!variantKey) return;

      const pk = String(productPk);

      if (allSelectedProductsRef.current.has(pk)) {
        const unselected = getUnselectedSetForProduct(pk);
        if (unselected.has(variantKey)) unselected.delete(variantKey);
        else unselected.add(variantKey);
        setCheckedVersion((v) => v + 1);
        return;
      }

      const s = checkedRef.current;
      if (s.has(variantKey)) s.delete(variantKey);
      else s.add(variantKey);

      setCheckedVersion((v) => v + 1);
    },
    [getUnselectedSetForProduct]
  );

  const getProductCheckboxState = useCallback((product) => {
    const pk = String(product?.productPk ?? "");
    const total = Number(product?.variantTotal || 0);

    if (allSelectedProductsRef.current.has(pk)) {
      const unselected = unselectedInAllRef.current.get(pk);
      const exceptionCount = unselected ? unselected.size : 0;

      return {
        allChecked: total > 0 && exceptionCount === 0,
        someChecked: exceptionCount > 0,
        disabled: total === 0,
      };
    }

    const keys = (product?.variants || []).map(getVariantKey).filter(Boolean);
    const s = checkedRef.current;
    const checkedCount = keys.reduce((acc, k) => acc + (s.has(k) ? 1 : 0), 0);

    const canProveAll = !product?.variantsHasMore && total > 0;

    return {
      allChecked: canProveAll && checkedCount === total,
      someChecked: checkedCount > 0 && (!canProveAll || checkedCount < total),
      disabled: total === 0 && keys.length === 0,
    };
  }, []);

  const toggleAllForProduct = useCallback((product) => {
    const pk = String(product?.productPk ?? "");
    if (!pk) return;

    const isAllSelected = allSelectedProductsRef.current.has(pk);
    const unselected = unselectedInAllRef.current.get(pk);
    const hasExceptions = !!unselected && unselected.size > 0;

    if (isAllSelected && !hasExceptions) {
      allSelectedProductsRef.current.delete(pk);
      unselectedInAllRef.current.delete(pk);

      const keys = (product.variants || []).map(getVariantKey).filter(Boolean);
      keys.forEach((k) => checkedRef.current.delete(k));

      setCheckedVersion((v) => v + 1);
      return;
    }

    allSelectedProductsRef.current.add(pk);
    unselectedInAllRef.current.delete(pk);

    const keys = (product.variants || []).map(getVariantKey).filter(Boolean);
    keys.forEach((k) => checkedRef.current.delete(k));

    setCheckedVersion((v) => v + 1);
  }, []);

  const normalizeProducts = useCallback((list, existing = []) => {
    const existingMap = new Map(existing.map((p) => [String(p.productPk), p]));
    const next = [...existing];

    for (const raw of Array.isArray(list) ? list : []) {
      const productPk = raw.productPk ?? raw.pk ?? raw.id ?? "";
      const productTitle = raw.productTitle ?? raw.title ?? raw.name ?? "Product";
      const productImage1 = raw.productImage1 || raw.product_image1 || raw.headerImage || null;
      const sku = raw.sku ?? "";

      const variantsRaw = Array.isArray(raw.variants) ? raw.variants : [];
      const variants = variantsRaw.map((v) => ({
        ...v,
        variantPk: v.variantPk ?? v.pk ?? "",
        shopifyVariantID: v.shopifyVariantID ?? v.shopifyVariantId ?? null,
        title: v.title ?? v.name ?? "Inventory Item",
        sku: v.sku ?? "",
        image1: v.image1 || null,
        available: v.available ?? 0,
      }));

      const variantTotal = Number(raw.variantTotal || 0);
      const variantsOffset = Number(raw.variantsOffset ?? variants.length);
      const variantsHasMore =
        typeof raw.variantsHasMore === "boolean" ? raw.variantsHasMore : variantsOffset < variantTotal;

      const available = raw.available ?? variants.reduce((sum, v) => sum + Number(v.available || 0), 0);

      const key = String(productPk);
      const existingProduct = existingMap.get(key);

      const merged = existingProduct
        ? {
            ...existingProduct,
            ...raw,
            productPk,
            productTitle,
            productImage1,
            sku,
            available,
            variantTotal,
            variantsHasMore,
            variantsOffset,
            variants: (() => {
              const seen = new Set((existingProduct.variants || []).map((x) => String(x.variantPk)));
              const appended = [...(existingProduct.variants || [])];
              for (const v of variants) {
                const vk = String(v.variantPk);
                if (!seen.has(vk)) {
                  seen.add(vk);
                  appended.push(v);
                }
              }
              return appended;
            })(),
          }
        : {
            ...raw,
            productPk,
            productTitle,
            productImage1,
            sku,
            available,
            variantTotal,
            variantsHasMore,
            variantsOffset,
            variants,
          };

      if (existingProduct) {
        const idx = next.findIndex((p) => String(p.productPk) === key);
        if (idx >= 0) next[idx] = merged;
      } else {
        next.push(merged);
      }
      existingMap.set(key, merged);
    }

    return next;
  }, []);

  const fetchProductsPage = useCallback(
    async ({ offset, replace, search, searchField: searchFieldArg }) => {
      if (!companyPk || isNaN(Number(companyPk))) return;

      const setLoading = replace ? setLoadingProducts : setLoadingMoreProducts;
      setLoading(true);

      try {
        const res = await axios.get("http://localhost:4000/product-browser-list", {
          params: {
            companyPk,
            search: String(search || "").trim(),
            searchField: String(searchFieldArg || "all"),
            productOffset: offset,
            productLimit: 50,
            variantLimit: 100,
            variantOffset: 0,
          },
        });

        const incoming = res?.data?.products || [];
        const more = !!res?.data?.hasMoreProducts;

        setProducts((prev) => (replace ? normalizeProducts(incoming, []) : normalizeProducts(incoming, prev)));
        setProductOffset(offset);
        setHasMoreProducts(more);
      } catch (e) {
        if (replace) setProducts([]);
        setHasMoreProducts(false);
      } finally {
        setLoading(false);
      }
    },
    [companyPk, normalizeProducts]
  );

  const triggerSearch = useCallback(async () => {
    const nextSearch = String(filterInput || "").trim();
    const nextField = String(searchField || "productTitle");

    activeSearchRef.current = nextSearch;
    activeSearchFieldRef.current = nextField;

    checkedRef.current = new Set();
    setCheckedVersion((v) => v + 1);

    setProducts([]);
    setStickyProductPk(null);

    await fetchProductsPage({ offset: 0, replace: true, search: nextSearch, searchField: nextField });
  }, [fetchProductsPage, filterInput, searchField]);

  const loadMoreProducts = useCallback(async () => {
    if (!hasMoreProducts) return;

    const nextOffset = products.length;

    await fetchProductsPage({
      offset: nextOffset,
      replace: false,
      search: activeSearchRef.current,
      searchField: activeSearchFieldRef.current,
    });
  }, [fetchProductsPage, hasMoreProducts, products.length]);

  const isLoadingVariants = useCallback((productPk) => {
    return !!loadingVariantsRef.current.get(String(productPk));
  }, []);

  const setLoadingVariants = useCallback((productPk, val) => {
    loadingVariantsRef.current.set(String(productPk), !!val);
    bumpVariantLoadingTick((t) => t + 1);
  }, []);

  const loadAllVariantsForProduct = useCallback(
    async (product) => {
      const productPk = product?.productPk;
      if (!productPk) return;

      const key = String(productPk);
      if (isLoadingVariants(key)) return;

      setLoadingVariants(key, true);
      try {
        let offset = Number(product.variantsOffset || (product.variants || []).length || 0);
        const total = Number(product.variantTotal || 0);

        while (offset < total) {
          const res = await axios.get("http://localhost:4000/product-browser-variants", {
            params: {
              companyPk,
              productPk,
              variantOffset: offset,
              variantLimit: 100,
              search: activeSearchRef.current,
              searchField: activeSearchFieldRef.current,
            },
          });

          const incoming = res?.data?.variants || [];
          const nextOffset = Number(res?.data?.nextOffset ?? offset + incoming.length);

          setProducts((prev) => {
            const idx = prev.findIndex((p) => String(p.productPk) === key);
            if (idx < 0) return prev;

            const current = prev[idx];
            const seen = new Set((current.variants || []).map((v) => String(v.variantPk)));
            const mergedVariants = [...(current.variants || [])];

            for (const v of incoming) {
              const vk = String(v.variantPk);
              if (!seen.has(vk)) {
                seen.add(vk);
                mergedVariants.push(v);
              }
            }

            const updated = {
              ...current,
              variants: mergedVariants,
              variantsOffset: nextOffset,
              variantsHasMore: nextOffset < total,
            };

            const next = [...prev];
            next[idx] = updated;
            return next;
          });

          offset = nextOffset;
          if (!incoming.length) break;
        }
      } finally {
        setLoadingVariants(key, false);
      }
    },
    [companyPk, isLoadingVariants, setLoadingVariants]
  );

  const handleAddSelected = useCallback(() => {
    const selected = [];

    for (const p of products) {
      const productPk = String(p.productPk);

      const isAllSelectedForProduct = allSelectedProductsRef.current.has(productPk);
      const unselected = unselectedInAllRef.current.get(productPk) || new Set();

      for (const v of p.variants || []) {
        const k = getVariantKey(v);
        if (!k) continue;

        const isSelected =
          isAllSelectedForProduct ? !unselected.has(k) : checkedRef.current.has(k);

        if (isSelected) {
          selected.push({
            productPk: p.productPk,
            productTitle: p.productTitle,
            productImage1: p.productImage1,
            sku: p.sku,
            ...v,
          });
        }
      }
    }

    onAddSelected?.(selected);
    onClose?.();
  }, [onAddSelected, onClose, products]);

  const rows = useMemo(() => {
    const out = [];

    for (const p of products) {
      out.push({ type: "product", productPk: String(p.productPk) });

      for (const v of p.variants || []) {
        out.push({ type: "variant", productPk: String(p.productPk), variantPk: String(v.variantPk) });
      }

      if (p.variantsHasMore) out.push({ type: "loadAllVariants", productPk: String(p.productPk) });
    }

    if (hasMoreProducts) out.push({ type: "loadMoreProducts" });

    return out;
  }, [hasMoreProducts, products]);

  const productByPk = useMemo(() => {
    const m = new Map();
    for (const p of products) m.set(String(p.productPk), p);
    return m;
  }, [products]);

  const variantByProductVariantPk = useMemo(() => {
    const m = new Map();
    for (const p of products) {
      for (const v of p.variants || []) {
        m.set(`${String(p.productPk)}::${String(v.variantPk)}`, v);
      }
    }
    return m;
  }, [products]);

  const findStickyProductPkFromStartIndex = useCallback(
    (startIndex) => {
      for (let i = Math.min(startIndex, rows.length - 1); i >= 0; i -= 1) {
        if (rows[i]?.type === "product") return rows[i].productPk;
      }
      return null;
    },
    [rows]
  );

  const rowHeight = useCallback(
    ({ index }) => {
      const r = rows[index];
      if (!r) return 56;
      if (r.type === "product") return 76;
      if (r.type === "variant") return 72;
      if (r.type === "loadAllVariants") return 56;
      if (r.type === "loadMoreProducts") return 64;
      return 56;
    },
    [rows]
  );

  const renderFilters = useMemo(() => {
    const filtersUI = (
      <Grid container spacing={2} sx={{ mb: 2 }} alignItems="center">
        <Grid item xs={12} md={8}>
          <TextField
            fullWidth
            size="small"
            label="Search"
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                triggerSearch();
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Search" onClick={triggerSearch} sx={{ color: "warning.main" }}>
                    <SearchIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Grid>

        <Grid item xs={12} md={4}>
          <FormControl fullWidth size="small">
            <InputLabel id="pb-search-field-label">Search by</InputLabel>
            <Select
              labelId="pb-search-field-label"
              label="Search by"
              value={searchField}
              onChange={(e) => {
                const next = String(e.target.value || "productTitle");
                setSearchField(next);
              }}
            >
              {SEARCH_FIELDS.map((f) => (
                <MenuItem key={f.value} value={f.value}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    );

    if (!isMobileMd) {
      return (
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Filters
          </Typography>
          {filtersUI}
        </Box>
      );
    }

    return (
      <>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: filtersOpen ? 1 : 0,
          }}
        >
          <Typography variant="subtitle2">Filters</Typography>
          <IconButton size="small" onClick={() => setFiltersOpen((prev) => !prev)}>
            {filtersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>

        <Collapse in={filtersOpen} timeout="auto" unmountOnExit>
          {filtersUI}
        </Collapse>
      </>
    );
  }, [filterInput, filtersOpen, isMobileMd, searchField, triggerSearch]);

  const stickyProduct = stickyProductPk ? productByPk.get(String(stickyProductPk)) : null;

  const StickyProductHeader = useMemo(() => {
    if (!stickyProduct) return null;

    const { allChecked, someChecked, disabled: productDisabled } = getProductCheckboxState(stickyProduct);

    const productImage =
      stickyProduct.productImage1 ||
      stickyProduct.product_image1 ||
      stickyProduct.headerImage ||
      stickyProduct.variants?.[0]?.image1 ||
      null;

    return (
      <Box
        role="button"
        tabIndex={0}
        onClick={() => toggleAllForProduct(stickyProduct)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleAllForProduct(stickyProduct);
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          p: 1,
          borderRadius: 1.5,
          bgcolor: sectionBg,
          border: "1px solid",
          borderColor: "divider",
          mb: 1,
          cursor: "pointer",
          outline: "none",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Checkbox
          checked={allChecked}
          indeterminate={someChecked}
          disabled={productDisabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            toggleAllForProduct(stickyProduct);
          }}
        />

        <Avatar
          variant="rounded"
          src={productImage || undefined}
          alt={stickyProduct.productTitle}
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            mr: 1.5,
            bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.800" : "grey.200"),
          }}
        >
          {!productImage && <ImageIcon fontSize="small" sx={{ opacity: 0.7 }} />}
        </Avatar>

        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: "0.95rem", flex: 1, minWidth: 0 }} noWrap>
          {stickyProduct.productTitle}
        </Typography>

        <Typography variant="body2" sx={{ width: !isLgDown ? "170px" : "64px", textAlign: "right", fontWeight: 600 }}>
          {formatAvailableQty(stickyProduct.available)}
        </Typography>
      </Box>
    );
  }, [checkedVersion, getProductCheckboxState, isLgDown, sectionBg, stickyProduct, toggleAllForProduct]);

  const rowRenderer = useCallback(
    ({ index, key, style }) => {
      const r = rows[index];
      if (!r) return <div key={key} style={style} />;

      const wrapStyle = { ...style, paddingRight: 8, boxSizing: "border-box" };

      if (r.type === "product") {
        const p = productByPk.get(String(r.productPk));
        if (!p) return <div key={key} style={wrapStyle} />;

        const { allChecked, someChecked, disabled: productDisabled } = getProductCheckboxState(p);

        const productImage = p.productImage1 || p.product_image1 || p.headerImage || p.variants?.[0]?.image1 || null;

        return (
          <div key={key} style={wrapStyle}>
            <Box
              role="button"
              tabIndex={0}
              onClick={() => toggleAllForProduct(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleAllForProduct(p);
                }
              }}
              sx={{
                border: "2px solid",
                borderColor: "divider",
                borderRadius: 2,
                px: 1.25,
                py: 0.75,
                bgcolor: sectionBg,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                outline: "none",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                disabled={productDisabled}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleAllForProduct(p);
                }}
              />

              <Avatar
                variant="rounded"
                src={productImage || undefined}
                alt={p.productTitle}
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  mr: 1.5,
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.800" : "grey.200"),
                }}
              >
                {!productImage && <ImageIcon fontSize="small" sx={{ opacity: 0.7 }} />}
              </Avatar>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: "0.95rem" }} noWrap>
                  {p.productTitle}
                </Typography>

                {!!p.sku && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                    {p.sku}
                  </Typography>
                )}
              </Box>

              <Typography variant="body2" sx={{ width: !isLgDown ? "80px" : "64px", textAlign: "right", fontWeight: 600 }}>
                {formatAvailableQty(p.available)}
              </Typography>
            </Box>
          </div>
        );
      }

      if (r.type === "variant") {
        const v = variantByProductVariantPk.get(`${r.productPk}::${r.variantPk}`);
        const p = productByPk.get(String(r.productPk));
        if (!v || !p) return <div key={key} style={wrapStyle} />;

        const vKey = getVariantKey(v);
        const checked = isVariantChecked(p.productPk, vKey);

        const productImage = p.productImage1 || p.product_image1 || p.headerImage || p.variants?.[0]?.image1 || null;
        const image1 = v.image1 || productImage || null;

        return (
          <div key={key} style={wrapStyle}>
            <Box
              role="button"
              tabIndex={0}
              onClick={() => toggleVariantKey(p.productPk, vKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleVariantKey(p.productPk, vKey);
                }
              }}
              sx={{
                ml: !isLgDown ? 4 : 2,
                display: "flex",
                alignItems: "center",
                p: 1,
                borderRadius: 1.5,
                border: "1px solid",
                borderColor: checked ? "primary.main" : "divider",
                bgcolor: checked ? "action.hover" : "background.paper",
                gap: 1.5,
                cursor: "pointer",
                "&:hover": { bgcolor: checked ? "action.selected" : "action.hover" },
                outline: "none",
              }}
            >
              <Checkbox
                checked={checked}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleVariantKey(p.productPk, vKey);
                }}
              />

              <Avatar
                variant="rounded"
                src={image1 || undefined}
                alt={v.title}
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 2,
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.800" : "grey.200"),
                }}
              >
                {!image1 && <ImageIcon fontSize="small" sx={{ opacity: 0.7 }} />}
              </Avatar>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {v.title ?? "Variant"}
                </Typography>

                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {v.sku || ""}
                </Typography>
              </Box>

              <Typography variant="body2" sx={{ width: !isLgDown ? "80px" : "64px", textAlign: "right" }}>
                {formatAvailableQty(v.available)}
              </Typography>
            </Box>
          </div>
        );
      }

      if (r.type === "loadAllVariants") {
        const p = productByPk.get(String(r.productPk));
        if (!p) return <div key={key} style={wrapStyle} />;

        const loading = isLoadingVariants(p.productPk);

        return (
          <div key={key} style={wrapStyle}>
            <Box sx={{ ml: 6, mt: 0.5 }}>
              <Button fullWidth variant="outlined" color="warning" disabled={loading} onClick={() => loadAllVariantsForProduct(p)}>
                {loading ? "Loading variants..." : `Load All Variants (${p.variantTotal - (p.variantsOffset || 0)} remaining)`}
              </Button>
            </Box>
          </div>
        );
      }

      if (r.type === "loadMoreProducts") {
        return (
          <div key={key} style={wrapStyle}>
            <Box sx={{ mt: 1 }}>
              <Button fullWidth variant="outlined" color="warning" disabled={loadingMoreProducts} onClick={loadMoreProducts}>
                {loadingMoreProducts ? "Loading more products..." : "Load More Products"}
              </Button>
            </Box>
          </div>
        );
      }

      return <div key={key} style={wrapStyle} />;
    },
    [
      getProductCheckboxState,
      isLgDown,
      isLoadingVariants,
      isVariantChecked,
      loadAllVariantsForProduct,
      loadMoreProducts,
      loadingMoreProducts,
      productByPk,
      rows,
      sectionBg,
      toggleAllForProduct,
      toggleVariantKey,
      variantByProductVariantPk,
    ]
  );

  const ColumnHeader = useMemo(() => {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1.5,
          py: 0.75,
          bgcolor: sectionBg,
          borderRadius: 1.5,
          border: "1px solid",
          borderColor: "divider",
          mb: 1,
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flex: 1, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.08 }}
        >
          Product
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            width: 170,
            textAlign: "right",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.08,
            flexShrink: 0,
          }}
        >
          Available
        </Typography>
      </Box>
    );
  }, [sectionBg]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={isLgDown || forceFullScreen}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" component="span">
          Select products
        </Typography>

        {!isLgDown && (
          <IconButton size="small" onClick={() => setForceFullScreen((prev) => !prev)}>
            {forceFullScreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          display: "flex",
          flexDirection: "column",
          height: isLgDown || forceFullScreen ? "100%" : 650,
          minHeight: 0,
        }}
      >
        {renderFilters}

        <Box sx={{ flex: "1 1 0%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loadingProducts ? (
            <Typography variant="body2" color="text.secondary">
              Loading products...
            </Typography>
          ) : products.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No available items match these filters.
            </Typography>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {ColumnHeader}
              {StickyProductHeader}

              <Box sx={{ flex: 1, minHeight: 0 }}>
                <AutoSizer>
                  {({ height, width }) => (
                    <List
                      width={width}
                      height={height}
                      rowCount={rows.length}
                      rowHeight={rowHeight}
                      rowRenderer={rowRenderer}
                      overscanRowCount={10}
                      onRowsRendered={({ startIndex }) => {
                        const pk = findStickyProductPkFromStartIndex(startIndex);
                        setStickyProductPk(pk);
                      }}
                    />
                  )}
                </AutoSizer>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={disabled}>
          Cancel
        </Button>
        <Button variant="contained" disabled={!anySelections || disabled} onClick={handleAddSelected}>
          Add selected
        </Button>
      </DialogActions>
    </Dialog>
  );
});

function ProductBrowser({ companyPk, darkMode = false, disabled = false, searchLabel = "Search products", onAddSelected }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSearchPreset, setDialogSearchPreset] = useState("");

  const openDialogWithSearch = useCallback((searchText) => {
    setDialogSearchPreset(String(searchText || "").trim());
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleAddSelected = useCallback(
    (selected) => {
      onAddSelected?.(selected);
    },
    [onAddSelected]
  );

  return (
    <>
      <MemoSearchProductsBar disabled={disabled} onOpenWithSearch={openDialogWithSearch} searchLabel={searchLabel} />

      <MemoProductBrowserDialog
        open={dialogOpen}
        companyPk={companyPk}
        darkMode={darkMode}
        disabled={disabled}
        initialSearch={dialogSearchPreset}
        onClose={closeDialog}
        onAddSelected={handleAddSelected}
      />
    </>
  );
}

ProductBrowser.propTypes = {
  companyPk: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  darkMode: PropTypes.bool,
  disabled: PropTypes.bool,
  searchLabel: PropTypes.string,
  onAddSelected: PropTypes.func,
};

export default ProductBrowser;