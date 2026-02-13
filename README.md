## Quick Access Link
https://realrussianboi.github.io/Shopify-Integrated-PDF-Generator/

# Shopify-Integrated PDF Generator

A full-stack JavaScript demo app that pulls live product data from Shopify, collects purchase order details in a React UI, and generates a polished, downloadable PDF on demand.

This project is built to showcase practical full-stack skills—frontend form handling, third-party API integration, backend PDF generation, and a clean “send data → receive file” workflow.

## What it does

* **Fetches products from Shopify** and displays them in a simple, single-page interface.
* Uses **react-hook-form** to collect purchase order inputs (vendor, destination, dates, shipping info, line items, etc.).
* Lets you **add products to a table/grid**, edit purchase descriptions, and calculate totals.
* Sends the finalized PO data to an **Express server**.
* The server generates a **PDF using pdf-lib** (including text layout, pagination, and embedded images/fonts).
* Returns the PDF as a **downloadable file** immediately—no page reloads, no manual file handling.

## Why this project exists

This repo is a focused demonstration of:

* Full-stack JavaScript development (React + Node/Express)
* Third-party integration (Shopify)
* Form state management and validation (react-hook-form)
* File responses in web apps (returning a PDF blob to the client)
* Programmatic document generation (pdf-lib) with real layout constraints

## The below image shows the live Shopify store populated with sample Snowboard products.
<img width="2501" height="1263" alt="Products Page Test Store" src="https://github.com/user-attachments/assets/472385cf-f1cf-4471-93de-c7747d1dc294" />

This is the store from which our server fetches products.

## The below PDF is an example of the Purchase Order PDF generation the program is capable of.

[Purchase Order 10001.pdf](https://github.com/user-attachments/files/25278674/Purchase.Order.10001.pdf)

## KEEP IN MIND
The server for this project is hosted on a free version of Render, and is allocated only 512 MB of Ram, and 0.1 CPU.
When creating a purchase order with at least 3 products, please wait at least ten to fifteen seconds for the PDF to be generated.
The time required for generating a PDF scales with product quantity only because the CPU is severely limited on the free Render hosting version.
