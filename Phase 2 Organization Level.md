# Organizational level logged in 

## Organization level Logo
## Fix the issue on our date picker seems like this is not yet globally read the styling it was destroyed in production deployed site

## Dashboard Module
**Problem:** when logging in as part of the organization i am seeing the platforms dashboard that supposed to be only the main platform admin can see.
**Solution:** We need to create a dashboard based to our current focus area organization which is Car Expert
**Features:**
- Header filter for filtering the Daily/Weekly/Monthly Sales
- Cards Section for the Sales, Petty Cash, Jobs Done
- Inventory Section like the Operations Control and this should have cards of Receiving PO, Stock Alert
- Expenses Section: here we can input a daily expense
- Deposit Section


## Inventory Module
**Features:**
- in our inventory we need to make a history/log history of stock adjustments of each item in example if i manually aadjusted the stock quantity it should be recorded as manually modified by and before adjustment it may required a password so for the security purpose and if the stock adjusted or updated using PO we need to connect the PO in the item adjustment history
- in creating also add a field for Margin percentage and in this we will give 2 options for the user if they enter a percentage margin the system will ask if they want to automatically compute and set the selling price base on the margin % they put.
-in Purchase Order Tab we should have search filter by Supplier
-in this i need the Report - Month, Category
    - so if the filter is selected the list of report must show this on table 
   [ Item/Description, Unit Cost, SRP, Beg. BAL (this must calculate the begining balanace of quantity every start of the month), SALES<list the date of the date of the month like 1,2,3,4,5,6...>(and when theres a sales on that day it could count it), Total Sales, Total Purchase, Ending Inventory, Actual Count (this should input by the user in the end of the month), Inventory Shortage (based on Ending Inventory - Actual Count), Remarks (GOOD - GREEN "Ending Inventory == Actual Count", BAD - RED "Ending Inventory != Actual Count")]
- After the report is generated we must have an export excel maybe later we can design it if its possible just now lets focus ng the structure

##Job Order Module
**Features:**
- on released state of the JO we should have a reprint receipt and if the receipt is reprinted lets put a watermark so it will identifiable as REPRINTED
- in Viewing an in-progress job order we should have an edit Service and parts so if theirs any additional works or items in that job order they can make an another approval and the last approval must be recorded as Change Logs. and this change logs will be added on the tabs beside History. also in this feature we need to record the job order movement like Job Order Created, Approval, Modification, and any other flow like payments.
- now in for payment status if i view it we should have a Settle Payment before Releasing the Vehicle then after the payment the Print Receipt/Invoice will show.