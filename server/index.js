import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { logger, requestLogger } from "./utils/logger.js";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { PDFDocument, rgb, StandardFonts, } from "pdf-lib";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import fontkit from "@pdf-lib/fontkit";
import WORLD_COUNTRIES from "./utils/Countries/WORLD_COUNTRIES.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.json({ limit: "25mb" }));

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
app.listen(PORT, () => console.log("Server running on", PORT));

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
      {
        pk: 1,
        name: "Acme Supplies Co.",
        address: "1250 Industrial Blvd",
        aptSuite: "Suite 200",
        city: "Orlando",
        state: "FL",
        zipCode: "32819",
        country: "US",
        phoneNumber1: "+1 (407) 555-0138",
        faxNumber1: "+1 (407) 555-0199",
        email1: "orders@acmesupplies.com",
        website: "https://acmesupplies.com",
        account: "ACME-100284",
        repFirstName: "Jordan",
        repLastName: "Meyers",
        repTitle: "Account Manager",
        repOfficePhoneNumber: "+1 (407) 555-0144",
        repCellPhoneNumber: "+1 (407) 555-0171",
        repEmail: "jordan.meyers@acmesupplies.com",
        notes: "Preferred carrier: UPS Ground. Net 30 terms by default. Email POs to orders@acmesupplies.com.",
        companyPk: 1,
      },
      {
        pk: 2,
        name: "Northwind Wholesale",
        address: "77 Harbor Way",
        aptSuite: "Building B",
        city: "Boston",
        state: "MA",
        zipCode: "02110",
        country: "US",
        phoneNumber1: "+1 (617) 555-0116",
        faxNumber1: "+1 (617) 555-0183",
        email1: "purchasing@northwindwholesale.com",
        website: "https://northwindwholesale.com",
        account: "NW-458210",
        repFirstName: "Avery",
        repLastName: "Chen",
        repTitle: "Senior Sales Rep",
        repOfficePhoneNumber: "+1 (617) 555-0124",
        repCellPhoneNumber: "+1 (617) 555-0166",
        repEmail: "avery.chen@northwindwholesale.com",
        notes: "Ships from East Coast DC. Include PO number on all cartons. Supports EDI upon request.",
        companyPk: 1,
      },
      {
        pk: 3,
        name: "Blue Ridge Packaging",
        address: "4020 Blue Ridge Pkwy",
        aptSuite: "Unit 12",
        city: "Asheville",
        state: "NC",
        zipCode: "28806",
        country: "US",
        phoneNumber1: "+1 (828) 555-0147",
        faxNumber1: "+1 (828) 555-0192",
        email1: "sales@blueridgepackaging.com",
        website: "https://blueridgepackaging.com",
        account: "BRP-902175",
        repFirstName: "Samantha",
        repLastName: "Ortiz",
        repTitle: "Customer Success Lead",
        repOfficePhoneNumber: "+1 (828) 555-0153",
        repCellPhoneNumber: "+1 (828) 555-0178",
        repEmail: "s.ortiz@blueridgepackaging.com",
        notes: "Common items: corrugate, poly mailers, tape. Lead time 3–5 business days for stocked SKUs.",
        companyPk: 1,
      },
      {
        pk: 4,
        name: "Summit Office & Industrial",
        address: "9800 Summit Park Dr",
        aptSuite: "Floor 3",
        city: "Denver",
        state: "CO",
        zipCode: "80202",
        country: "US",
        phoneNumber1: "+1 (303) 555-0109",
        faxNumber1: "+1 (303) 555-0190",
        email1: "po@summitofficeindustrial.com",
        website: "https://summitofficeindustrial.com",
        account: "SUM-330771",
        repFirstName: "Blake",
        repLastName: "Reynolds",
        repTitle: "Territory Representative",
        repOfficePhoneNumber: "+1 (303) 555-0120",
        repCellPhoneNumber: "+1 (303) 555-0162",
        repEmail: "blake.reynolds@summitofficeindustrial.com",
        notes: "Delivers twice weekly to local warehouses. Discount tiers available for orders over $5,000.",
        companyPk: 1,
      },
    ].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })
    );

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

//Creates an exportable PDF for PO's.
app.post("/purchase-order/export/pdf", async (req, res) => {
  const { poNumber, billingAddress, shippingAddress, dates, rows, summary, } = req.body;

  try {
    const currentDate = new Date().toLocaleDateString().toString().replace(/\//g, "-");
    const currentTime = new Date().toLocaleTimeString().toString().replace(/:/g, "-");

    const docTitle = `Purchase Order #${poNumber} made ${currentDate} at ${currentTime}`;

    //All the following code is in charge of creating the actual document and its contents.
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    let pageContainer = [page];

    //Declare document margins.
    const { width, height } = page.getSize();
    const topMargin = height - 40;
    const bottomMargin = 40;
    const leftMargin = 40;
    const rightMargin = width - 40;
    const verticalDistanceBetweenText = 10;

    //This section is responsible for the top center of our first page.

    // Size params of logo image box.
    const boxWidth = 200;
    const boxHeight = 100;
    const imageBoxX = (width - boxWidth) / 2;
    const imageBoxY = height - boxHeight - 10;
    const boxSideMargins = 60;

    // Draw a box for the image as container. This will also be our temporary image, since I failed to actualy load one.
    page.drawRectangle({
      x: imageBoxX,
      y: imageBoxY,
      width: boxWidth,
      height: boxHeight,
      borderColor: rgb(1, 1, 1), // Set the border color (black in this case)
      borderWidth: 1, // Set the border width
    });

    const imagePath = path.join(__dirname, "./Images/snowboardlogo.png");
    const imageBytes = fs.readFileSync(imagePath);
    const image = await pdfDoc.embedPng(imageBytes);

    // Get the original dimensions of the image
    const originalWidth = image.width;
    const originalHeight = image.height;

    // Calculate scaling factor to fit within the box while keeping the aspect ratio
    const scaleX = (boxWidth - 10) / originalWidth;
    const scaleY = (boxHeight - 10) / originalHeight;
    const scaleFactor = Math.min(scaleX, scaleY);  // Use the smaller scaling factor to maintain aspect ratio

    // Calculate the new scaled dimensions
    const scaledWidth = originalWidth * scaleFactor;
    const scaledHeight = originalHeight * scaleFactor;

    // Center the image within the box
    const imageX = imageBoxX + (boxWidth - scaledWidth) / 2;
    const imageY = imageBoxY + (boxHeight - scaledHeight) / 2;

    // Draw the image inside the box with the new dimensions
    page.drawImage(image, {
      x: imageX,
      y: imageY,
      width: scaledWidth,
      height: scaledHeight,
    });

    //This section starts writing text in our document. 

    //Function to create indents in order to not overlap text on other objects. 
    const createIndents = (providedText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin) => {
      let strBuilder = ""; //strBuilder starts empty. 
      let currentStringWithoutNewline = ""; //Will gradually add new words/letters to strBuilder.
      let changeableXCoord = currentXCoodinateOfText; //Will represent the current coordinate of each letter. 

      for (let i = 0; i < providedText.length; i++) { //Loops over the text.
        const currentWidthOfText = tFont.widthOfTextAtSize(providedText[i], sizeOfFont); //Finds width of current character.
        changeableXCoord += currentWidthOfText; //Calculates the xCoord of right side of our string.

        if (changeableXCoord >= rMargin - (sizeOfFont / 2)) { //If that xCoord overlaps with rMargin, we indent.
          strBuilder += currentStringWithoutNewline + "\n";
          changeableXCoord = currentXCoodinateOfText; //Reset to defualt xCoord.
          currentStringWithoutNewline = providedText[i]; //Sets to start a new line. 
        } else {
          currentStringWithoutNewline += providedText[i]; //Continues old line by adding new character. 
        }
      }

      strBuilder += currentStringWithoutNewline; //Appends remaining part of the string.

      return strBuilder;
    };

    const createIndentsFromSpace = (providedText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin) => {
      let strBuilder = ""; //strBuilder starts empty. 
      let totalWidthOfSection = 0;
      const allowedWidth = rMargin - currentXCoodinateOfText;
      const dividedTxt = providedText.split(" ");

      if (dividedTxt.length === 1) {
        return createIndents(providedText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin);
      }

      let firstIteration = true;
      for (let i = 0; i < dividedTxt.length; i++) { //Loops over the text.
        let currentText = " ";
        if (firstIteration) {
          currentText = dividedTxt[i];
          firstIteration = false;
        } else {
          currentText = " " + dividedTxt[i];
        }
        const currentWidthOfText = tFont.widthOfTextAtSize(currentText, sizeOfFont); //Finds width of current character.

        if (totalWidthOfSection + currentWidthOfText < allowedWidth) {
          totalWidthOfSection += currentWidthOfText;
          strBuilder += currentText;
        } else {
          if (currentWidthOfText > allowedWidth) {
            strBuilder += "\n" + createIndents(currentText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin);
            continue;
          } 
          strBuilder += "\n" + dividedTxt[i];
          totalWidthOfSection = tFont.widthOfTextAtSize(dividedTxt[i], sizeOfFont);
        }
      }
      strBuilder[0] === " " ? strBuilder = strBuilder.trimStart() : strBuilder = strBuilder;
      return strBuilder;
    };

    const createIndentsForEmails = (providedText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin) => {
      let strBuilder = ""; //strBuilder starts empty. 

      const allowedWidth = rMargin - currentXCoodinateOfText;
      const dividedTxt = providedText.split("@");

      if (tFont.widthOfTextAtSize(providedText,sizeOfFont) <= allowedWidth) {
        return providedText; //If default Email as a whole fits in the allowed width, ends code here.
      }

      if (dividedTxt.length === 1) {
        return createIndents(providedText, tFont, sizeOfFont, currentXCoodinateOfText, rMargin);
      }
      
      const part1 = dividedTxt[0];
      const part2 = "@" + dividedTxt[1];
      const currentWidth1 = tFont.widthOfTextAtSize(part1,sizeOfFont);
      const currentWidth2 = tFont.widthOfTextAtSize(part2,sizeOfFont);

      let editedPart1 = "";
      let part1WasEdited = false;

      if (currentWidth1 < allowedWidth || currentWidth1 === allowedWidth) {
        strBuilder = part1 + "\n" + part2;
      } else if (currentWidth1 > allowedWidth) {
        editedPart1 = createIndents(part1, tFont, sizeOfFont, currentXCoodinateOfText, rMargin);
        part1WasEdited = true;
      }

      if (part1WasEdited) {
        const editedPart1length = editedPart1.split("\n").length;
        const editedPart1LastPart = editedPart1.split("\n")[editedPart1length - 1];
        const editedPart1LastPartWidth = tFont.widthOfTextAtSize(editedPart1LastPart,sizeOfFont);

        if (editedPart1LastPartWidth + currentWidth2 < allowedWidth) {
          strBuilder = editedPart1 + part2;
        } else {
          strBuilder = editedPart1 + "\n" + part2;
        }
      }
      
      return strBuilder;
    };

    //Function to print text from indents without such large gaps that natural indents have.
    const printTextFromIndents = (textWithIndents, X, Y, Size, Font, Color, currentPage) => {
      const arrayWithIndents = textWithIndents.split('\n');

      let changeableY = Y;

      for (const txt of arrayWithIndents) { //Loops over array and prints the text with smaller indents.
        changeableY -= Font.heightAtSize(Size); //Lowers the text's Y value a bit lower each time.
        currentPage.drawText(txt, { //Draws each individual line of text. 
          x: X,
          y: changeableY,
          size: Size,
          font: Font,
          color: Color,
        });
      }
    };

    let finalYValue = 100000;
    //Function to automate the creation of the Shipping section.
    const automateShippingBillingSectionCreation = (arrayOfShippingParts, Font, FontSize, X, Y, verticalGap, txtRGB, lineRGB, currentPage) => {

      let yValue = Y;
      const lineLimitLength = X + 150;
      let numOfLines = 1;

      let i = 0;
      for (const part of arrayOfShippingParts) { 
        
        yValue -= (Font.heightAtSize(FontSize) * numOfLines) + verticalGap;
        
        if (i != 7) {
          printTextFromIndents( //Draws text that says someone's name.
            createIndentsFromSpace(part,Font,FontSize,X,lineLimitLength),
            X,
            yValue,
            FontSize,
            Font,
            txtRGB,
            currentPage
          );
        } else {
          printTextFromIndents( //Draws text that says someone's name.
            createIndentsForEmails(part,Font,FontSize,X,lineLimitLength),
            X,
            yValue,
            FontSize,
            Font,
            txtRGB,
            currentPage
          );
        }
        i++;

        //Draws a dividing line between the different sections.
        numOfLines = createIndentsFromSpace(part,Font,FontSize,X,lineLimitLength).split('\n').length;
        const yLineValue = yValue - (Font.heightAtSize(FontSize) * numOfLines) - (verticalGap / 2);
        
        if (yLineValue < finalYValue) {
          finalYValue = yLineValue;
        }

        // page.drawLine({
        //   start: { x: X - 1.5, y: yLineValue - 1.5 },
        //   end: { x: lineLimitLength, y: yLineValue - 1.5},
        //   thickness: 1,
        //   color: lineRGB,
        // });

      } 
    };

    //Function to write Po Rows.
    const PoRowWriter = async (
      Rows,
      columnsArray,
      startingMargin,
      Font,
      FontSize,
      Y,
      verticalGap,
      txtRGB,
      lineRGB,
      currentPage,
      bottomMargin
    ) => {
      let yValue = Y;
      let yLineValue;
      let numOfLines = 1;
      let ourPage = currentPage;
      let allYValues = new Map();

      let firstIteration = true;

      // widths come from columns now
      const columnSpacing = 5;
      const imageColWidth = columnsArray.find((c) => c.field === "headerImage")?.width ?? columnsArray[0].width;
      const imageSize = imageColWidth - columnSpacing;

      for (const row of Rows) {
        let largestHeight = null;
        let currentMargin = startingMargin;

        const numToSubtractFromYValue = Math.max(Font.heightAtSize(FontSize) * numOfLines, largestHeight);

        if (firstIteration) {
          yValue -= numToSubtractFromYValue + verticalGap / 2 - Font.heightAtSize(FontSize);
          firstIteration = false;
        }

        numOfLines = 0;

        // ✅ Build values for this row based on fields that match columnsArray.field
        const valueByField = {
          headerImage: row.headerImage ?? "",
          sku: row.sku ?? "",
          purchDesc: row.purchDesc ?? "",
          qty: row.qty ?? "",
          cost: row.cost ?? "",
          extendedCost: row.extendedCost ?? "",
          tax: row.tax ?? "",
          lineTotal: row.lineTotal ?? "",
        };

        // ✅ Map follows columnsArray order automatically
        const rowContents = new Map(
          columnsArray.map((col) => [
            { field: col.field, value: valueByField[col.field] ?? "" },
            col.width,
          ])
        );

        for (const [Key, Value] of rowContents) {
          const keyText = String(Key.value ?? "");

          if (Key.field === "headerImage") {
            // Pagination check uses purchDesc (same intent as before)
            const wrappedDesc = createIndentsFromSpace(
              String(valueByField.purchDesc ?? ""),
              Font,
              FontSize,
              currentMargin,
              currentMargin + (columnsArray.find((c) => c.field === "sku")?.width ?? 0)
            );

            const descLines = wrappedDesc.split("\n").length;

            if (
              yValue - Font.heightAtSize(FontSize) * descLines < bottomMargin + ((verticalGap / 3) * 2) ||
              yValue - imageSize < bottomMargin + ((verticalGap / 3) * 2)
            ) {
              allYValues.set(ourPage, yValue);
              ourPage = pdfDoc.addPage();
              pageContainer.push(ourPage);
              yValue = topMargin - 10;
            }

            if (keyText) {
              try {
                const response = await fetch(keyText);
                const imageBytes = await response.arrayBuffer();
                const contentType = response.headers.get("content-type") || "";

                let image;
                if (contentType.includes("png")) image = await pdfDoc.embedPng(imageBytes);
                else if (contentType.includes("jpg") || contentType.includes("jpeg")) image = await pdfDoc.embedJpg(imageBytes);
                else {
                  const pngBuffer = await sharp(Buffer.from(imageBytes)).png().toBuffer();
                  image = await pdfDoc.embedPng(pngBuffer);
                }

                const { width: imgWidth, height: imgHeight } = image;

                const scaleFactor = Math.min(
                  (imageSize - columnSpacing) / imgWidth,
                  (imageSize - columnSpacing) / imgHeight,
                  1
                );

                ourPage.drawImage(image, {
                  x: currentMargin,
                  y: yValue - imageSize,
                  width: imgWidth * scaleFactor,
                  height: imgHeight * scaleFactor,
                });
              } catch (error) {
                logger.error(`Failed to load image: ${keyText}`, error);
              }
            }

            currentMargin += Value;
            continue;
          }

          const rightmostMargin = currentMargin + Value;

          const text = createIndentsFromSpace(
            keyText,
            Font,
            FontSize,
            currentMargin,
            rightmostMargin - columnSpacing
          );

          const textHeight = text.split("\n").length * Font.heightAtSize(FontSize);

          printTextFromIndents(text, currentMargin, yValue, FontSize, Font, txtRGB, ourPage);

          largestHeight = Math.max(textHeight, imageSize);

          const currentNumberOfLines = text.split("\n").length;
          if (numOfLines < currentNumberOfLines) numOfLines = currentNumberOfLines;

          currentMargin += Value;
        }

        const largerNumber = Math.max(Font.heightAtSize(FontSize) * numOfLines, largestHeight);
        yLineValue = yValue - largerNumber - verticalGap / 2;

        ourPage.drawLine({
          start: { x: startingMargin, y: yLineValue },
          end: { x: rightMargin, y: yLineValue },
          thickness: 1,
          color: lineRGB,
        });

        yValue -= largerNumber + verticalGap - Font.heightAtSize(FontSize) / 2;
        allYValues.set(ourPage, yValue);
      }

      return { Y: yLineValue, allYs: allYValues };
    };

    const automateSummarySection = (
      rows,
      allowedMargins,
      Font,
      FontSize,
      X,
      Y,
      verticalGap,
      txtRGB,
      lineRGB,
      currentPage
    ) => {
      let yValue = Y;
      const rightmostMargin = X + allowedMargins;

      // helper: your “bold” effect without changing fonts
      const drawBold = (t, x, y) => {
        for (let i = 0; i < 2; i++) {
          currentPage.drawText(t, { x, y, size: FontSize, font: Font, color: txtRGB });
        }
      };

      let firstIteration = true;

      for (const row of rows) {
        if (!firstIteration) yValue -= verticalGap;
        firstIteration = false;

        // ---------- OLD MODE (string): keep existing behavior ----------
        if (typeof row === "string") {
          // mimic your old printing (supports wrapping)
          const textIndented = createIndentsFromSpace(row, Font, FontSize, X, rightmostMargin);
          const lines = textIndented.split("\n");

          // print lines
          for (const line of lines) {
            yValue -= Font.heightAtSize(FontSize);
            currentPage.drawText(line, { x: X, y: yValue, size: FontSize, font: Font, color: txtRGB });
          }

          continue;
        }

        // ---------- NEW MODE ({left,right}): left label + right-aligned value ----------
        const leftText = String(row?.left ?? "");
        const rightText = String(row?.right ?? "");

        // left side (can wrap)
        const leftIndented = createIndentsFromSpace(leftText, Font, FontSize, X, rightmostMargin);
        const leftLines = leftIndented.split("\n");

        // right side (NO wrap; right-aligned)
        const rightWidth = Font.widthOfTextAtSize(rightText, FontSize);
        const rightX = rightmostMargin - rightWidth;

        // line height for this row (based on wrapped left)
        const rowHeight = leftLines.length * Font.heightAtSize(FontSize);

        // print left lines
        let lineY = yValue;
        for (const line of leftLines) {
          lineY -= Font.heightAtSize(FontSize);

          if (row.boldLeft) drawBold(line, X, lineY);
          else currentPage.drawText(line, { x: X, y: lineY, size: FontSize, font: Font, color: txtRGB });
        }

        // print right value aligned to the right edge, vertically aligned to the first line
        // (same baseline as the first printed line)
        const firstLineY = yValue - Font.heightAtSize(FontSize);

        if (rightText) {
          if (row.boldRight) drawBold(rightText, rightX, firstLineY);
          else currentPage.drawText(rightText, { x: rightX, y: firstLineY, size: FontSize, font: Font, color: txtRGB });
        }

        // advance yValue by the full height we consumed
        yValue -= rowHeight;
      }

      return yValue; // final Y after drawing
    };

    //Receives a country code and returns its associated country.
    const countryLabelFromCode = (code) => {
      const cc = String(code || "").toUpperCase();
      if (!cc) return "";

      // Prefer your WORLD_COUNTRIES module if available in this file
      const fromList =
        WORLD_COUNTRIES?.find((c) => String(c.value).toUpperCase() === cc)?.label;

      if (fromList) return fromList;

      // Fallback (runtime locale lookup)
      try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) || cc;
      } catch {
        return cc;
      }
    };

    //Receives an object containing city, region, and postal code. Returns a logically ordered fragment of an address line.
    const formatCityRegionPostal = ({ city, region, postal_code }) => {
      const c = String(city || "").trim();
      const r = String(region || "").trim();
      const p = String(postal_code || "").trim();

      const cityRegion = [c, r].filter(Boolean).join(", ");
      return [cityRegion, p].filter(Boolean).join(" ");
    };

    //Cleans a string.
    const cleanedString = (v) => String(v ?? "").trim();

    // Helper for money formatting (handles null/undefined/strings) + thousands separators
    const money = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "";
      return n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    // Helper to coerce numbers safely
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    
    const fontPath = path.join(__dirname, 'Fonts', 'times.ttf'); //Enter font name here
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = fs.readFileSync(fontPath);  // Load the font file
    
    // Embed the Arial font into the PDF document
    let textFont = await pdfDoc.embedFont(fontBytes);  // Use the custom Arial font
    let headerFontSize = 13;
    let fontSize = 12;

    //Prints text in the top left, indicating store credentials and date the PDF was created. 
    let text = `Printed: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    fontSize = 10;

    page.drawText(text, { //Draws text that says Printed: Date
      x: leftMargin,
      y: topMargin + bottomMargin / 3,
      size: fontSize,
      font: textFont,
      color: rgb(0, 0, 0),
    });

    text = `Store: Summit Snowboards`;
    fontSize = 10;

    printTextFromIndents( //Draws text that says Store: #...
      createIndentsFromSpace(text, textFont, fontSize, leftMargin, rightMargin),
      leftMargin,
      topMargin - ((bottomMargin/2) * 3),
      fontSize,
      textFont,
      rgb(0, 0, 0),
      pageContainer[0]
    );

    //Draws a line to finish the top section of the first page.

    const verticalLineMargins = 25;
    const lineY = imageBoxY - verticalLineMargins;
    
    page.drawLine({
      start: { x: leftMargin, y: lineY },
      end: { x: rightMargin, y: lineY},
      thickness: 2,
      color: rgb(0.7, 0.7, 0.7), 
    });

    //Section of Shipping and PO details.
    text = "SHIPPING ADDRESS";
    headerFontSize = 14;
    let shippingSectionY = lineY - verticalLineMargins - 10;

    for (let addkljas = 0; addkljas != 2; addkljas++) { //Overlap text to make it darker and thicker (to make it bold).  
      page.drawText(text, { //Draws text that says SHIPPING ADRESS.
        x: leftMargin,
        y: shippingSectionY,
        size: headerFontSize,
        font: textFont,
        color: rgb(0, 0, 0),
      });
    }

    const arrayOfShippingParts = (() => {
      if (!shippingAddress) return [];

      const line1 = cleanedString(shippingAddress.line1);
      const line2 = cleanedString(shippingAddress.line2);
      const cityRegionPostal = cleanedString(formatCityRegionPostal(shippingAddress));
      const country = cleanedString(countryLabelFromCode(shippingAddress.country_code));
      const phone = cleanedString(shippingAddress.phone);
      const email = cleanedString(shippingAddress.email);

      // Logical print order for an address block
      return [line1, line2, cityRegionPostal, country, phone, email].filter(Boolean);
    })();

    fontSize = 11;
    shippingSectionY = lineY - verticalLineMargins - 5;
    const shippingSectionVerticalLineMargins = 5;

    automateShippingBillingSectionCreation( //Automate the creation of the Shipping Address section.
      arrayOfShippingParts,
      textFont,
      fontSize,
      leftMargin,
      shippingSectionY,
      shippingSectionVerticalLineMargins,
      rgb(0,0,0),
      rgb(0,0,0),
      pageContainer[0]
    );

    //Section of Billing Address
    text = "BILLING ADDRESS";
    headerFontSize = 14;
    shippingSectionY = lineY - verticalLineMargins - 10;
    const billingSectionLeftMargin = leftMargin + 150 + 33;

    for (let addkljas = 0; addkljas != 2; addkljas++) { //Overlap text to make it darker and thicker (to make it bold). 
      page.drawText(text, { //Draws text that says SHIPPING ADRESS.
        x: billingSectionLeftMargin,
        y: shippingSectionY,
        size: headerFontSize,
        font: textFont,
        color: rgb(0, 0, 0),
      });
    }

    const arrayOfBillingParts = [
      cleanedString("Summit Snowboards"), // Company name
      cleanedString(billingAddress?.line1),
      cleanedString(billingAddress?.line2),
      cleanedString(formatCityRegionPostal({
        city: billingAddress?.city,
        region: billingAddress?.region,
        postal_code: billingAddress?.postal_code,
      })),
      cleanedString(countryLabelFromCode(billingAddress?.country_code)),
      cleanedString(billingAddress?.phone),
      cleanedString(billingAddress?.email),
    ].filter(Boolean);

    shippingSectionY = lineY - verticalLineMargins - 5;

    automateShippingBillingSectionCreation( //Automate the creation of the Shipping Address section.
      arrayOfBillingParts,
      textFont,
      fontSize,
      billingSectionLeftMargin,
      shippingSectionY,
      shippingSectionVerticalLineMargins,
      rgb(0,0,0),
      rgb(0,0,0),
      pageContainer[0]
    );

    //Section of Shipping and PO details.
    text = "PURCHASE ORDER";
    headerFontSize = 14;
    shippingSectionY = lineY - verticalLineMargins - 10;
    const purchaseOrderSectionLeftMargin = billingSectionLeftMargin + 150 + 33;

    for (let addkljas = 0; addkljas != 2; addkljas++) { //Overlap text to make it darker and thicker (to make it bold). 
      page.drawText(text, { //Draws text that says PURCHASE ORDER.
        x: purchaseOrderSectionLeftMargin,
        y: shippingSectionY,
        size: headerFontSize,
        font: textFont,
        color: rgb(0, 0, 0),
      });
    }

    const arrayofPoNumParts = [
      `PO #${poNumber}`,

      // Ship first (actionable), then due (deadline), then void (status)
      dates?.dateToShip
        ? `Ship By: ${new Date(dates.dateToShip).toLocaleDateString()}`
        : "",

      dates?.dueDate
        ? `Due Date: ${new Date(dates.dueDate).toLocaleDateString()}`
        : "",

      dates?.dateVoid
        ? `Voided: ${new Date(dates.dateVoid).toLocaleDateString()}`
        : "",

      dates?.paymentTerms ? cleanedString( `Payment Terms: ${dates.paymentTerms}`) : "",

      dates?.shippingCarrier ? cleanedString(`Shipping Carrier: ${dates.shippingCarrier}`) : "",

      dates?.trackingNumber ? cleanedString(`Tracking #: ${dates.trackingNumber}`) : "",
    ].filter(Boolean);

    shippingSectionY = lineY - verticalLineMargins - 5;

    automateShippingBillingSectionCreation( //Automate the creation of the Shipping Address section.
      arrayofPoNumParts,
      textFont,
      fontSize,
      purchaseOrderSectionLeftMargin,
      shippingSectionY,
      shippingSectionVerticalLineMargins,
      rgb(0,0,0),
      rgb(0,0,0),
      pageContainer[0]
    );

    const shippingAndRowsSectionDividerY = finalYValue - verticalLineMargins - 10;

    const PoRowsSectionY = shippingAndRowsSectionDividerY;

    // column widths
    const imageWidth = 50;
    const skuWidth = 65;
    const purchaseDescriptionWidth = 100;
    const qtyWidth = 45;
    const costWidth = 65;
    const extendedCostWidth = 75;
    const taxWidth = 50;
    const lineTotalWidth =
      rightMargin -
      (leftMargin +
        imageWidth +
        skuWidth +
        purchaseDescriptionWidth +
        qtyWidth +
        costWidth +
        extendedCostWidth +
        taxWidth);

    const columns = [
      { field: "headerImage", text: "IMAGE", width: imageWidth },
      { field: "sku", text: "SKU", width: skuWidth },
      { field: "purchDesc", text: "DESCRIPTION", width: purchaseDescriptionWidth },
      { field: "qty", text: "QTY", width: qtyWidth },
      { field: "cost", text: "COST", width: costWidth },
      { field: "extendedCost", text: "EXT. COST", width: extendedCostWidth },
      { field: "tax", text: "TAX", width: taxWidth },
      { field: "lineTotal", text: "LINE TOTAL", width: lineTotalWidth },
    ];

    // Small helper to “double-draw” for your bold effect
    const drawBoldText = (text, x, y, size = headerFontSize) => {
      for (let i = 0; i < 2; i++) {
        page.drawText(text, {
          x,
          y,
          size,
          font: textFont,
          color: rgb(0, 0, 0),
        });
      }
    };

    // Render the header row
    let x = leftMargin;
    for (const col of columns) {
      drawBoldText(col.text, x, PoRowsSectionY, 10);
      x += col.width;
    }

    const PoRowsAndRowContentsLineDividerY = PoRowsSectionY - 10;

    page.drawLine({
      start: { x: leftMargin, y: PoRowsAndRowContentsLineDividerY },
      end: { x: rightMargin, y: PoRowsAndRowContentsLineDividerY },
      thickness: 3,
      color: rgb(0,0,0), 
    });

    const PoRowsArray = rows.map((row) => {
      const qty = Number(row.qtyOrdered ?? 0);
      const unit = Number(row.cost ?? row.unitCost ?? 0);

      const extended = Number.isFinite(qty) && Number.isFinite(unit) ? qty * unit : 0;

      const taxPercentRaw = Number(row.variantTax ?? 0);
      const taxRate = Number.isFinite(taxPercentRaw) ? taxPercentRaw / 100 : 0;

      const hasNonZeroTax = Number.isFinite(taxPercentRaw) && taxPercentRaw !== 0;
      const isTaxable = hasNonZeroTax || !!(row.variantTaxableResolved ?? row.variantTaxable);

      const rowTax = isTaxable ? extended * taxRate : 0;
      const lineTotal = extended + rowTax;

      return {
        ...row,

        headerImage: row.headerImage ?? row.image1 ?? row.previewImageURL ?? "",
        sku: row.variantSku ?? row.itemSku ?? "",

        purchDesc:
          row.variantDescriptionPurchase ??
          row.itemTitle ??
          "",

        qty: String(qty),
        cost: money(unit),
        extendedCost: money(extended),
        tax: money(rowTax),
        lineTotal: money(lineTotal),
      };
    });

    const PoRowsY = PoRowsAndRowContentsLineDividerY;
    const rowSectionVerticalLineMargins = 30;
    fontSize = 10;

    const resultsOfPoRowWriter = await PoRowWriter(
      PoRowsArray,
      columns,
      leftMargin,
      textFont,
      fontSize,
      PoRowsY,
      rowSectionVerticalLineMargins,
      rgb(0, 0, 0),
      rgb(0.7, 0.7, 0.7),
      pageContainer[0],
      bottomMargin
    );

    let summarySectionYval = resultsOfPoRowWriter.Y;
    let allYValues = resultsOfPoRowWriter.allYs;

    //Purchase Order Summary section. 
    let currentPage = pageContainer[pageContainer.length - 1];
    if (summarySectionYval < bottomMargin + 150) {
      pageContainer.push(pdfDoc.addPage());
      currentPage = pageContainer[pageContainer.length - 1];
      summarySectionYval = topMargin - 20;
    } else {
      summarySectionYval -= 40;
    }
  
    const { shipping, subtotal, total } = summary;

    const summaryRows = [
      { left: "Subtotal:", right: money(subtotal) },
      { left: "Shipping:", right: money(shipping) },
      { left: "Total:", right: money(total), boldLeft: true, boldRight: true },
    ];

    // box numbers you already have
    const summaryTextFontSize = 12;
    const summaryBoxInnerSideMargins = 10;
    const summarySectionBoxWidth = 200;

    const summarySectionBoxXval = rightMargin - summarySectionBoxWidth;

    // IMPORTANT: X is the left text start inside the box,
    // allowedMargins is the inner width (so right alignment is inside the box)
    const summaryTextX = summarySectionBoxXval + summaryBoxInnerSideMargins;
    const allowedInnerWidth = summarySectionBoxWidth - summaryBoxInnerSideMargins * 2;

    let summaryTextY = summarySectionYval;

    // draw (twice if you like your “darker” effect — optional)
    let summarySectionBoxY = -1;
    for (let i = 0; i < 1; i++) {
      summarySectionBoxY =
        automateSummarySection(
          summaryRows,
          allowedInnerWidth,
          textFont,
          summaryTextFontSize,
          summaryTextX,
          summaryTextY,
          verticalDistanceBetweenText,
          rgb(0, 0, 0),
          rgb(0, 0, 0),
          currentPage
        ) - summaryBoxInnerSideMargins;
    }

    const summarySectionBoxHeight =
      summaryTextY - summarySectionBoxY + (summaryBoxInnerSideMargins / 2);

    currentPage.drawRectangle({
      x: summarySectionBoxXval,
      y: summarySectionBoxY,
      width: summarySectionBoxWidth,
      height: summarySectionBoxHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    let partingMessage = "Thank you for using this free PDF Generator. We hope to see you again soon!";

    partingMessage = createIndentsFromSpace(
      partingMessage,
      textFont,
      summaryTextFontSize,
      leftMargin,
      rightMargin - summarySectionBoxWidth - 10
    );

    printTextFromIndents(
      partingMessage,
      leftMargin,
      summarySectionBoxY + ((summarySectionBoxHeight / 4) * 3),
      summaryTextFontSize,
      textFont,
      rgb(0,0,0),
      currentPage
    );

    //Page # Section.
    for (let i = 0; i < pageContainer.length; i++) {
      text = `Page ${i + 1} of ${pageContainer.length}`;
      fontSize = 10;
      if (i === 0) {
        pageContainer[i].drawText(text, { //Draws text that says Page #...
          x: rightMargin - textFont.widthOfTextAtSize(text,fontSize),
          y: topMargin + bottomMargin / 3,
          size: fontSize,
          font: textFont,
          color: rgb(0, 0, 0),
        });

        allYValues.forEach((value, key) => {
          if (pageContainer[i] === key) {
            if (value > bottomMargin)  {
              pageContainer[i].drawText("Powered by SyncBooks", { //Draws text that says Page #...
                x: leftMargin,
                y: bottomMargin / 2,
                size: fontSize,
                font: textFont,
                color: rgb(0, 0, 0),
              });
          
              pageContainer[i].drawText(text, { //Draws text that says Page #...
                x: rightMargin - textFont.widthOfTextAtSize(text,fontSize),
                y: bottomMargin / 2,
                size: fontSize,
                font: textFont,
                color: rgb(0, 0, 0),
              });
            }
          }
        });
      } else {
        pageContainer[i].drawText("Powered by SyncBooks", { //Draws text that says Page #...
          x: leftMargin,
          y: topMargin + bottomMargin / 3,
          size: fontSize,
          font: textFont,
          color: rgb(0, 0, 0),
        });
        pageContainer[i].drawText(text, { //Draws text that says Page #...
          x: rightMargin - textFont.widthOfTextAtSize(text,fontSize),
          y: topMargin + bottomMargin / 3,
          size: fontSize,
          font: textFont,
          color: rgb(0, 0, 0),
        });
    
        allYValues.forEach((value, key) => {
          if (pageContainer[i] === key) {
            if (value > bottomMargin)  {
              pageContainer[i].drawText("Powered by SyncBooks", { //Draws text that says Page #...
                x: leftMargin,
                y: bottomMargin / 2,
                size: fontSize,
                font: textFont,
                color: rgb(0, 0, 0),
              });
          
              pageContainer[i].drawText(text, { //Draws text that says Page #...
                x: rightMargin - textFont.widthOfTextAtSize(text,fontSize),
                y: bottomMargin / 2,
                size: fontSize,
                font: textFont,
                color: rgb(0, 0, 0),
              });
            }
          }
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    // Create a readable stream from the PDF bytes
    const pdfStream = new Readable();
    pdfStream.push(pdfBytes);
    pdfStream.push(null); // Signal the end of the stream

    // Set the appropriate headers for PDF response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${docTitle}.pdf`);
    
    // Pipe the PDF stream to the response
    pdfStream.pipe(res);
  } catch (error) {
    logger.error(`Error exporting purchase order to PDF: ${error.message}\n${error.stack}`);
    res.status(500).send(`Error exporting purchase order to PDF: ${error.message}`);
  }
});