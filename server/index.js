import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { logger, requestLogger } from "./utils/logger.js";

dotenv.config();

const app = express();

app.use(express.json());

// Allow your frontend (add your GitHub Pages origin later)
app.use(
  cors({
    origin: [
      "http://localhost:5173", // Vite dev
      "http://localhost:3000",
    ],
  })
);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

const SHOP_NAME = process.env.shop_name; // e.g. "your-shop" OR "your-shop.myshopify.com"
const SHOPIFY_ACCESS_TOKEN = process.env.acccess_token;
const SHOPIFY_API_VERSION = "2026-04";

const normalizeShopDomain = (s) => {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.includes(".myshopify.com") ? v : `${v}.myshopify.com`;
};

const shopDomain = normalizeShopDomain(SHOP_NAME);

const shopifyGraphQL = async ({ query, variables }) => {
  if (!shopDomain) throw new Error("Missing SHOP_NAME in .env");
  if (!SHOPIFY_ACCESS_TOKEN) throw new Error("Missing SHOPIFY_ACCESS_TOKEN in .env");

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Admin API token goes in this header
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await resp.json();

  if (!resp.ok) {
    const msg = json?.errors?.[0]?.message || `Shopify GraphQL error (${resp.status})`;
    throw new Error(msg);
  }

  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || "Shopify GraphQL error");
  }

  return json.data;
};

function escapeShopifyQueryValue(s) {
  // escape quotes and backslashes for query strings
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();
};

function buildShopifySearchQuery(search, searchField) {
  const q = String(search || "").trim();
  if (!q) return null;

  const value = escapeShopifyQueryValue(q);

  // If user typed multiple words, AND them together for better "contains-ish" behavior
  const terms = value.split(/\s+/).filter(Boolean);

  const fieldMap = {
    productTitle: "title",
    variantTitle: "variant_title",
    sku: "sku",
  };

  const field = fieldMap[searchField] || "title";

  // Phrase query if it has spaces; otherwise raw token
  if (terms.length > 1) {
    // AND each term under the same field:
    // title:caramel title:apple
    return terms.map((t) => `${field}:${t}`).join(" ");
    // Alternatively (more strict phrase):
    // return `${field}:"${value}"`;
  }

  // single token
  return `${field}:${terms[0]}`;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Get PO form lists (vendors + warehouses) - hard-coded (no DB)
app.get("/purchase-order/data-for-new", async (req, res) => {

  try {
    const vendorsList = [
      { pk: 1, name: "Acme Supplies Co." },
      { pk: 2, name: "Northwind Wholesale" },
      { pk: 3, name: "Blue Ridge Packaging" },
      { pk: 4, name: "Summit Office & Industrial" },
    ].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));

    const warehousesList = [
      {
        pk: 101,
        name: "Main Warehouse",
        description: "Primary fulfillment center",
        active: true,

        addressPk: 1001,
        addressLine1: "123 Commerce St",
        addressLine2: "Suite 200",
        addressCity: "Orlando",
        addressRegion: "FL",
        addressPostalCode: "32801",
        addressCountryCode: "US",
        addressPhone: "+1 (407) 555-0101",
        addressEmail: "main-warehouse@example.com",
      },
      {
        pk: 102,
        name: "Northeast DC Warehouse",
        description: "Regional distribution center",
        active: true,

        addressPk: 1002,
        addressLine1: "77 Harbor Ave",
        addressLine2: "",
        addressCity: "Newark",
        addressRegion: "NJ",
        addressPostalCode: "07102",
        addressCountryCode: "US",
        addressPhone: "+1 (973) 555-0144",
        addressEmail: "ne-dc@example.com",
      },
      {
        pk: 103,
        name: "West Coast DC Warehouse",
        description: "Overflow and returns processing",
        active: true,

        addressPk: 1003,
        addressLine1: "900 Market Blvd",
        addressLine2: "",
        addressCity: "Phoenix",
        addressRegion: "AZ",
        addressPostalCode: "85004",
        addressCountryCode: "US",
        addressPhone: "+1 (602) 555-0199",
        addressEmail: "west-dc@example.com",
      },
    ].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));

    return res.status(200).json({
      vendorsList,
      warehousesList,
    });
  } catch (error) {
    logger?.error?.(`Error fetching PO form lists: ${error.message}\n${error.stack}`);
    return res.status(500).send(`Error fetching PO form lists: ${error.message}`);
  }
});

app.get("/product-browser-list", async (req, res) => {
  try {
    const {
      search = "",
      searchField = "productTitle",
      productOffset = 0,
      productLimit = 50,
    } = req.query;

    const allowedFields = new Set(["productTitle", "variantTitle", "sku"]);
    const searchFieldSafe = allowedFields.has(String(searchField)) ? String(searchField) : "productTitle";

    const productOffsetNum = Math.max(0, Number(productOffset) || 0);
    const productLimitNum = Math.min(50, Math.max(1, Number(productLimit) || 50)); // keep sane
    const pageIndex = Math.floor(productOffsetNum / productLimitNum);

    const queryStr = buildShopifySearchQuery(search, searchFieldSafe);

    const PRODUCTS_Q = `
      query Products($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            totalInventory
            featuredImage { url }
            images(first: 1) { nodes { url } }
            variants(first: 250) {
              nodes {
                id
                title
                sku
                inventoryQuantity
                image { url }
              }
            }
          }
        }
      }
    `;

    // Walk cursors to reach the requested "offset page"
    let after = null;
    let pageInfo = null;

    for (let i = 0; i < pageIndex; i += 1) {
      const data = await shopifyGraphQL({
        query: PRODUCTS_Q,
        variables: { first: productLimitNum, after, query: queryStr },
      });

      pageInfo = data?.products?.pageInfo || null;
      after = pageInfo?.endCursor || null;

      if (!pageInfo?.hasNextPage) break;
    }

    // Fetch the actual page requested
    const data = await shopifyGraphQL({
      query: PRODUCTS_Q,
      variables: { first: productLimitNum, after, query: queryStr },
    });

    const conn = data?.products;
    const nodes = conn?.nodes || [];
    const hasMoreProducts = !!conn?.pageInfo?.hasNextPage;

    const products = nodes.map((p) => {
      const productImage1 =
        p?.featuredImage?.url ||
        p?.images?.nodes?.[0]?.url ||
        null;

      const variants = (p?.variants?.nodes || []).map((v) => ({
        variantPk: v.id,
        shopifyVariantID: v.id,
        title: v.title || "Inventory Item",
        sku: v.sku || "",
        available: Number(v.inventoryQuantity || 0),
        image1: v?.image?.url || productImage1 || null,
      }));

      const productSku = variants.find((x) => x.sku)?.sku || "";

      const available =
        typeof p?.totalInventory === "number"
          ? Number(p.totalInventory)
          : variants.reduce((sum, v) => sum + Number(v.available || 0), 0);

      return {
        productPk: p.id,
        shopifyID: p.id,
        productTitle: p.title || "Product",
        productImage1,
        sku: productSku,
        available,

        // ✅ variants returned all-at-once (no paging)
        variantTotal: variants.length,
        variantsHasMore: false,
        variantsOffset: variants.length,
        variants,
      };
    });

    res.json({
      products,
      productOffset: productOffsetNum,
      productLimit: productLimitNum,
      hasMoreProducts,
    });
  } catch (error) {
    logger?.error?.(`Error fetching Shopify products: ${error.message}\n${error.stack}`);
    res.status(500).send("Error fetching products.");
  }
});

app.get("/product-browser-variants", async (req, res) => {
  try {
    const { productPk } = req.query;
    if (!productPk) return res.status(400).send("Invalid productPk.");

    const VARIANTS_Q = `
      query ProductVariants($id: ID!) {
        product(id: $id) {
          id
          featuredImage { url }
          images(first: 1) { nodes { url } }
          variants(first: 250) {
            nodes {
              id
              title
              sku
              inventoryQuantity
              image { url }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL({ query: VARIANTS_Q, variables: { id: String(productPk) } });

    const p = data?.product;
    const productImage1 =
      p?.featuredImage?.url ||
      p?.images?.nodes?.[0]?.url ||
      null;

    const variants = (p?.variants?.nodes || []).map((v) => ({
      variantPk: v.id,
      shopifyVariantID: v.id,
      title: v.title || "Inventory Item",
      sku: v.sku || "",
      available: Number(v.inventoryQuantity || 0),
      image1: v?.image?.url || productImage1 || null,
    }));

    res.json({
      productPk: String(productPk),
      variantTotal: variants.length,
      variantOffset: 0,
      variantLimit: variants.length,
      variants,
      hasMoreVariants: false,
      nextOffset: variants.length,
    });
  } catch (error) {
    logger?.error?.(`Error fetching Shopify variants: ${error.message}\n${error.stack}`);
    res.status(500).send("Error fetching variants.");
  }
});

// ---- Route: gets variant details for PO rows ----
app.get("/purchase-order/get/item-data", async (req, res) => {
  try {

    const rawSelected =
      req.query.selectedPks ??
      req.query["selectedPks[]"] ??
      [];

    const selectedPkArray = Array.isArray(rawSelected)
      ? rawSelected
      : rawSelected != null
        ? [rawSelected]
        : [];

    const variantIds = selectedPkArray
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    if (variantIds.length === 0) {
      return res.status(400).json({
        error: "selectedPks is required (array of Shopify variant ids)",
        gotQueryKeys: Object.keys(req.query),
      });
    }

    if (variantIds.length === 0) {
      return res.status(400).json({ error: "selectedPks is required (array of Shopify variant ids)" });
    }

    // Shopify nodes() has practical limits—batch to be safe
    const batches = chunk(variantIds, 100);

    const NODES_Q = `
      query VariantNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            sku
            inventoryQuantity
            image { url }
            product {
              id
              title
              featuredImage { url }
              images(first: 1) { nodes { url } }
            }
            inventoryItem {
              unitCost {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `;

    const allVariants = [];

    for (const ids of batches) {
      const data = await shopifyGraphQL({ query: NODES_Q, variables: { ids } });
      const nodes = data?.nodes || [];
      for (const n of nodes) {
        if (n && n.id) allVariants.push(n);
      }
    }

    const items = allVariants.map((v) => {
      const productTitle = v?.product?.title || "";
      const variantTitle = v?.title || "";
      const sku = v?.sku || "";

      const productImage1 =
        v?.product?.featuredImage?.url ||
        v?.product?.images?.nodes?.[0]?.url ||
        null;

      const headerImage = v?.image?.url || productImage1 || null;

      const purchaseDesc = `${productTitle} ${variantTitle}`.replace(/\s+/g, " ").trim();

      const cost = Number(v?.inventoryItem?.unitCost?.amount ?? 0) || 0;
      const qtyOnHand = Number(v?.inventoryQuantity ?? 0) || 0;

      return {
        headerImage,

        productTitle,
        productPk: v?.product?.id || null,

        variantPk: v?.id,
        shopifyVariantID: v?.id,

        variantTitle,
        variantSku: sku,

        variantDescriptionPurchase: purchaseDesc,

        qtyOnHand,

        cost,
        costExtended: cost,
        qtyOrdered: 1,
      };
    });

    return res.status(200).json({ items });
  } catch (error) {
    logger?.error?.(`Error fetching Shopify variant items: ${error.message}\n${error.stack}`);
    return res.status(500).json({ error: `Error fetching items: ${error.message}` });
  }
});