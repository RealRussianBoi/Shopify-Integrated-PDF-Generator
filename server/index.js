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