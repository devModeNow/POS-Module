# Phase 1 Improvements

## Overview

This document covers all changes implemented in Phase 1 of the Centralized Business Information System (CBIS) project.

---
# Car Expert Organization

## 1. Inventory Module

### 1.1 Inventory List 

**Feature:** To this page I need to list all of the Inventory products and accesories of car expert. and in this page we have 
- buttons like [Purchase Deliveries, Reports, Add New Product, Download Inventory]
- search filters: search box, selection of [Good Stock, Warning Stock, Bad Stock], Date of Delivery (date range)
- table: [selection (all/multiple), Product Name, Brand, Category, Quantity, Cost, SRP Purcahsed (total sold of quatity for the current month), Month Sales (Total sales on current Month), Remarks (with Color Coding of [Good (Green), Warning (Amber), Bad (Red)])] also this needs to be paginated and server side pagination i want, in the bottom of the table we should have Totals of the displayed Results.

### 1.2 Purchase Deliveries

**Feature:** To this page I need the list and create of purchase orders made to add a product inventory quantity base on 1.1 requirements.
- on create we need a
  -smart search for a Supplier
  -Payment Details (payment type, date, amount, reference number, notes)
  -smart search for product then if that product is still not exist in the inventory its fine we should show the create new product fields like selecting a brand and category and etc. but if exists lets ignore the create new details of product.
  -Quantity
  -Unit Cost
  - Button for Add Item so we can add another product item and compute the total after add and display in the table list
  - Text Area of Comments/Remarks
  - in thee bottom of the form we have create order and cancel button
  
- on Viewing we need to show all of the details and items inside the PO
- in the main page we should have table list and displays the [PO Number, Supplier, Order Producs (view in chips and max display of 3 and put ... if more than that), Total Ordered Quantity, Total Cost, Order Date]

### 1.3 Reports

**Feature:** To this page we should have a Filters on first load and here are the filters we need:
- Month, Category
    - so if the filter is selected the list of report must show this on table 
   [ Item/Description, Unit Cost, SRP, Beg. BAL (this must calculate the begining balanace of quantity every start of the month), SALES<list the date of the date of the month like 1,2,3,4,5,6...>(and when theres a sales on that day it could count it), Total Sales, Total Purchase, Ending Inventory, Actual Count (this should input by the user in the end of the month), Inventory Shortage (based on Ending Inventory - Actual Count), Remarks (GOOD - GREEN "Ending Inventory == Actual Count", BAD - RED "Ending Inventory != Actual Count")]
- After the report is generated we must have an export excel maybe later we can design it if its possible just now lets focus ng the structure

