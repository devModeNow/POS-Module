##TASKS

#TASK 1
- add a feature on the POS Inventory dashboard make the add item accept image for the item image
- For the POS dashboard, redesign it and make it compatible to tablet/touch screen devices because this system will be used using a tablet or an ipad
    - Show the product images in cards once clicked it will be added to the cart or item lists
    - add a search feature in it
    - show product product name in the card overlaying the image
    - show price below
    //Continuation
    - Once Complete Sale clicked, show a prompt where the user/cashier can add the amount of money that he/she received from the customer/buyer and make it auto compute so that she will know how much change she will be giving to the customer
    - add a feature where the cashier can apply or add a discount (we'll work on the type of discounts later).
    - In the Inventoty adding add a field where I can choose a type in which wheater its a grams, kilo, pack, sack etc...
    - In the Inventory table show the product image too
    - In the Inventory adding, make the margin computation automated based on cost and price
    - In the side menu, make the POS Sales in priority, make it first to show in dashboard after login.
    - In POS Sales, make the product cards bigger so it would be appealing and fit the view of using a tablet or an ipad, make it look like this POS system was made specifically for a touchscreen device.
    //Continuation 2.0
    - Make the product cards slightly bigger
    - In inventory, add a product category so that I can sort/filter product category
    - Every product category will have multiple products under it
    - On the complete payment popup, make the Discount field as a dropdown with the dropdown values having different types and amount of discount. Create a table in the database with these values, name it tbldiscounts and these are the values
        - Senior Citizen Discount - 10% discount
        - PWD Discount - 10%
        - Auto discount based on product price and package like sale or bulk sale
    - In the reports, make a different type of reports that you think is needed for a store
    - Add fake product datas with categories, price, some have sale price, different kind of Unit Type. Products you will be adding are focused on snacks like, roasted peanut, beans, fried corn, gummy bears, jellyace etc...
    - Fix all error issues and errors you will see
    //Continuation 2.1
    - We will be needing some restructuring, slightly hehe. So basically for the inventory, when we add an inventory currently we enter the category but we need to change that, change it to like a dropdown in which I can pick existing category and if not existing I can just type it and it will automatically be added to the list of categories once saved
    - We need also to add a product variants, In this part I can enter whichever is applicable for the product I am entering like for example I am entering a peanunt and we know that there are different kinds of peanut, right? so yeah I want to be able to enter or pick a product type or a variant for each product I am entering.
    - Now for the POS view, what I want is to just show a product type like for example peanut, it will only show the peanut product card, once click it will show a popup in which it will show the product variants, quantity etc... anything that you can think of that will be needed for each product that has been set upon entering in inventory, also make the product name a bit larger hehe
    - Also just a quick update, upon login make the sidenav show as closed by default.
    - make the actions in the Inventory table and POS show as icons not text to save space
    - make the cart width a bit smaller, not so tight not so wide
    - make sure to have a popup confirmation for every action specially when deleting or updating data and products
    - for the sale price on checkout popup, I notice that when a sale product is added its still showing the original price in the popup unless I picked the sale price in the discount dropdown which is wrong. Please correct that and get the sale price automatically once the product select is on sale.
    - still for the checkout popup, add a payment methods dropdown and also add it to the database for now [Cash, Online Payment[Gcash, Maya, Bank Transfer], Food Panda]. For food panda payment method make the status of it in the backend for reporting as "Floating" because it is not live when receiving the payment there's a certain time from the app. Other methods can be added to the report immediatley as payments from those are received on time.
    - For the reporting tab, could you create a creative dashboard with graphs and complete filters to generate and see specific amounts, breakdowns. Make sure that its all accurate and complete data.
    - Update all existing mockup data according to updated design and architecture, make sure to add variants, right product types under the right product and category.
    - make sure to fix all errors and bugs you will encounter while building
    //Continuation 2.2
    - In the reports dashboard, show all by default based on Report Type just to no show blank upon opening
    //Continuation 2.3
    - Need some changes on adding a product, so basically the flow will be Category first then Product type which is for example peanut then there will be a feature where I can be able to add multiple peanut type (Variants) under the product type peanut then each peanut will also be having a choice of unit like for example in pack, kilo, sack or manual where in the cashies can be able to input the grams in the product card popup before adding it to the cart. Most importantly is to make it applicable to all products, types and categories not only for peanut that I used as an example so expect to have different kinds of units.
    - Make it clear for every fields, add label into it like price, cost, margin etc...
    - In POS make the product image size dimension equal to make to look uniform and look good.
    - When product is added to the card, also show the unit type used.
    - on the checkout popup, on the discount computaion when product is already sale and I selected a discount it will be added to the sale amount as discount, do not override the sale discount amount just add the discount I selected.
    - Make sure to fix all errors and bugs you encounter while working on this task
    //Continuation 2.4
    - When adding in inventory make it able to add multiple unit type in each variant as every variant can be bought in different unit types.
    - When adding variant, show the new form on top not on the bottom, also change the +add variant text into icon.
    - In adding a Product type, add the feature to add product type image, also add image picker to each variants so that I can be able to upload image for different variants.
    - In the POS product card popup, show the unit types in dropdown that can be selectable, when Manual was chosen show a textbox based on what unit it is (Ex. grams) and compute automatically.
    - Inside the POS popup add also a live search so that where there are too many variants the cashier can be able to do a search
    - In POS product cards show the product type image, once clicked and the variants will show the variant image also along with the info of the variants for each.
    - In POS product card do not show the price, only the image, Product type name, stock and variants count will do.
    - In the cart, show the image of the product variant added not the product type image, also show the variant name as main title and under it the product type
    - Retain the cart items do not remove as long as the transaction or sale is not still done, even I go to a different page.
    - make the scrollbars hidden unless its scrolled to make it look good
    - In the checkout popup, make the default Amount Recieved to 0 so that the Confirm Sale button is disabled unless right amount is inserted to avoid click errors.
    - In the Payment Methods, edit data remove the text "Online -" infront of each Gcash, Maya and Bank Trasfer.
    - Hide cart when and while empty.
    - Make sure to fix all errors and bugs you encounter while working on this task
    //Continuation 2.5
    - In the invetory, when deleting an item/s make sure to just sof delete it, do not delete it peremanently/
    - Add a filter like "Deleted Items"so that I can still be able to see the deleted items and be able to restore it.
    - Add pagination in the inventory table
    - Change the Add Product button in the inventory into icon
    - In the cart,change the showing amount under unit type for each added variant into its total price not the price itself per unit.
    - Make sure to fix all errors and bugs you encounter while working on this task.
    //Continuation 2.6
    - In adding inventory, when adding a unit, make the newly added unit on top not on bottom
    - in Inventory, Product variant views, when opening a specific variant, make the edit form able to edit the specific variant selected only not the whole Product type
    - add a differect shade of background color in adding unit form so that its not confusing to see.
    - In inventory Product Variants view, make the Variant column as priority not the product type. So for example Product = Peanut, Variant = Sweet peanut. It should show Variant column first but in Product types view it show the Product column first.
    - In the inventory table, add a settings where in we can hide,unhide columns and add also a sorting function.
    - In inventory adding unit, remove the Manual and make the Grams (Fixed unit) as Grams
    - In POS view, sort the products best selling first and so on.
    - In POS view,add a toggle where in they can choose a different views like, list view or products cards view.
    - Make sure to fix all errors and bugs you encounter while working on this task.
    //Continuation 2.7
    - since,this system will be used mainly on tablet device, could you make the texts a bit bigger specially on the forms.
    - change the forms in the inventory into popup modals instead of a side form so it will be bigger
    - In the UI part, as you can see on the popup after you clicked a product you will see that the unit dropdown and the quantity box is not equal in position, could you fix that and make sure that its equal in position.
    - make the (first if many variant) quantity box auto focus when variant popup show.
    - make the main search feature in the POS able to search even the variant, not only the product type.
    - position the main search textbox below view type and above the category pills in 100% width.
    - make the items in the cart editable like whe  I click an item, I can be able to edit the unit of it.
    - In inventory table, make the "Stock" or "Total stock" column values use the right number formatting like when its 20000 it should be 20,000
    - In inventory view, "Product types" view, add red pill in the text "Sale" in "Price Range" column.
    - Make sure to fix all errors and bugs you encounter while working on this task.
    //Continuation 2.8
    - I created a new user specifically for cashier, I want you to remove all the header and side bar when cashier is logged in, I want it to show only the POS dashbaord itself.
    - remove the autofocus on quantity inputs on product popup forms. Add a - and + icons on left and right so its more easy to use on a touchscreen environment.
    - In the pos dashboard, under the seachbox, you see the product categories pills that can be use as filters, I want you to chage it into a dropdown when the pills counts are more than 5.
    - In the adding product form modal, make the form radius less, I want it to look more shap edges, same to the buttons.
    - Use icons instead of text in the forms.
    - In image selectors, remove the choose image/variant image button and make the image template as the main button when picking an image, its just to make it look more modern.
    - Make sure to fix all errors and bugs you encounter while working on this task.
    //Continuation 2.8
    - In adding product form modal, while I am typing product details I suddenly clicked outside the form and the form closed and the details I inserted was gone. Could you make it retain the details I input even I accidentally closed the form.
    - In the POS, add an option to view the products by product type or by product variants, if product vriants are picked, product cards or list will show each products not each product type.
    - In the POS main search, show result by products so that when they search an specific product it will show the product card not the product type.
    - Make all the borders radius including the images, buttons, modal forms etc... more sharp, I dont want those too rounded.
    - In the POS account dashboard, add a confirmation message before logging out to lessen the sudden logout error.
    - Make sure to fix all errors and bugs you encounter while working on this task.
    //Continuation 2.9
    - for posadmin dashboard, add a complete user management feature, apply all settings you know is applicable and usable.
    - for posadmin dashboard, add a feature where I can add unit types, so those unit types will be available on a dropdown selector when adding a product variant.
    - in adding a product under each variant, edit the Unit types form, add a feature where in I can set which unit type and value will be the default unit type for that specific variant so that when the product variant is selected in POS the selected default unit type will the first one.
    - In POS account dashboard, make the whole UI automatically fit on any landscape window size so there will be no horizontal and vertical scroll except the scroll on the product cards.
    - In POS account dasboard, on checkout modal popup fix the sizing of it because currently its not fit on the tablet, make it dynamic in sizing make it scrollable and max 98% in height, remove autofocus on Amount Recieved textbox.
    - In POS product cards, make the format of the in stock text into right number format for example 19800 in stock to 19,800 in stock.
    - Make sure to fix all errors and bugs you encounter while working on this task.
   //Continuation 3.0
   - In the POS dashboard, change the text POINT OF SALE into the cashiers name, and show the companys name.
   - In the POS dashboad, change the Card/List and Product Types/Variants selector into just icons.
   - Make the Selectors, Category dropdown and Search bar into 1 line, so the header will not occupy to much space.
   - In the POS dashboard, add a Sales dashboard where in for each cashier they can see how much their sales, basically its like a sales report page for each cashier.
   - In the admin dashboard, add in the menu with a where in it can show the on duty cashier.
   - In the admin dashboard, add a company profile page where in the admin can edit the company image, logo, company name and details like description etc...
   - In the admin dashboard, add a printer settings where in the admin can modify the printing format and sizes.
   - In the cashier dashboard, add a void feature where in when there is an item that already punched in can be voided, but it needs a admin code that needs to be provided by the admin, also the codes can be set in the admin dashboard.
   - In the admin dashboard, Add a page where in it will show all actions for each user, its like a audit trail for all action that is happening in the system.
   - Add a loader for each action so that user will know smething is clicked or something.
   - In all dashboard, make all search function into smart search its like showing when searching a product card will show under.
   - Add a edit profile function for all user dashboard.
   - Disable slide to refreh in app mode.
   - In all table with filter and selector function, don't make the whole page loads because currently when you click like the variants/ product selector the selector itself is disappearing which is not correct.
   - in all dashboard remove the popup confirmations like the popup when adding a product in cart.
   - Make sure to fix all errors and bugs you encounter while working on this task.
   //Continuation 3.1
   - In posadmin dashbaord, create a interactive dashboard where it show all data, like sales, reports, active users, daily sales, etc... all you can think of that is necessary to show on a main dashboard. Use graphs and colored cards and make it draggable position. Make this dashboard as the main after login.
   - In posadmin dashboard, make the Audit Trail and User Management under Settings, do not show in the main side bar.
   - In both posadmin and poscashier dashboard, replace the POS Admin and POS Cashier texts into name of logged-in user and under it show their role which is Admin or Cashier. Under it show the company name/Business name that is entered on the settings.
   - Make the attached logo in the settings to be shown on login and in sidebar.
   - In the Print settings, add a preview so that I can preview how it looks before saving.
   - In Void Codes, add a show code icon like in the password so that I can see what code is entered.
   - In the settings->system, make sure all fields, image picker are working so that all the data that will be inserting is saving.
   - In the settings->system, make the image picker moder, remove the choose file button and make the image container as the picker itself just like the image picker in the Edit Profile page.
   - In the main header, show the name beside the profile pic because currently its showing the position.
   - In posadmin->reports, add actions to it like being able to change payment status from float to other status or to settled something like that so its not only for viewing reports but also to navigate and change some data.
   - In the POS dashboard, add a button which the cashier can pick to use its own device keyboard or the POS keyboard which you will need to create. If device keyboard is picked, it will use its own keyboard, but if POS keyboard was picked it will use our POS keyboard.
   - Make sure to fix all errors and bugs you encounter while working on this task.
   - Make sure to check all taskss under this continuation before setting it to done because in the past there are tasks that has not been done so be sure to check if its all done properly and without errors and bugs.   
   //Continuation 3.2
   - Add a printer settings for both posadmin and cashier dashboard, the settings will have the feature to setup the printer, can pick a printer, can choose a size and also can be able to do a preview, also can be able to custom edit the contents and save its format, I want it modifiable like I can add an image, text and position it where I want within the printing area.
   - Fix the pos keyboard because currently the keyboard is below the modal popups.
   - In the posadmin main dashboard, when the cards are clicked, add actions to its popup like I can change status of sales etc...
   - Add both posadmin and cashier dashboarda chat feature, a small window in bottom right is fine, it is for the admin and cashier can be able to communicate while using this system. Add a feature to hide it when the user doesn't want to use it.
   - Add a notification bell for both dashboard, for admin dashboard, notify when someone is made a sale or there is a new message. For Cashier dashboard notify when there is new message.
   - in the posadmin dasboard header, remove the textbox saying "Search or type command..."
   - Remove "Account Settings" under "Edit profile" in the posadmin dashboard header dropdown.
   - In posadmin main dashboard, make the cards resizable also same as the charts.
   - In posadmin dashboard, in the sidebar in the bottom remove the text showing the "Admin (name)" also the words POS and POS.
   - In the login page, the logo I saved from the posadmin settings is not showing, its showing a different logo. Fix it, make sure to show the logo I used/saved from the posadmin settings.
   - Make sure to fix all errors and bugs you encounter while working on this task.
   - Make sure to check all taskss under this continuation before setting it to done because in the past there are tasks that has not been done so be sure to check if its all done properly and without errors and bugs.
   //Continuation 3.3
   -Fix the print settings, when I am removing an element and adding it again it is showing below the existing elements meaning the drag positioning is not accurate or not working properly.
   -In POS dashboard, the keboard is overlapping the textbox, fix this one make the pos keyboard more compact in size and when its activated make sure to make the popups with textbox or inputs to make it scrollable so that it can still show the input fields.
   - In chat feature, add feature where in they can have choice to do a team chat or a private chat to user.
   - In notifications, when the notification is new message, make it clickable, once clicked open the chat.
   - In notifications, when its new sales or else, make sure its clickable and once clicked it will open the approriate page of dashboard like for example when there's a new sale, once clicked it will redirect to a page where in it will show the detailed information about that sale, including product, total amount, money received, amount money change if there is any, Cashiers name and etc...
   - In POS dashboard, make sure to make it automatically full screen so that it will not show the url bar and it will look more clean.
   - Make sure to fix all errors and bugs you encounter while working on this task.
   - Make sure to check all taskss under this continuation before setting it to done because in the past there are tasks that has not been done so be sure to check if its all done properly and without errors and bugs.
   //Continuation 3.4
   - remove the auto fullscreen in cashier dashboard.
   - In posadmin, when recieving message notifications, make sure to just notify it when message is from others, do not notify on own sent messages.
   - In posadmin, when I recieved a message from private user, I recieved 2 same messages which the private user only sent one. Fix that one.
   - In posadmin, the notification for new complete sale from cashier is not receiving, posadmin should be notified once there is a confirm sale.
   - In cashier dashboard, make sure to redirect to receipt printing once comfirm sale is complete.
   - Fix the notification bell, the number count of notif is not showing properly, its currently under the bell.
   - In print settings, when I press print preview, its showing the print preview of whole page, make sure to just print preview the actual paper size and actual view the reciept of what saved in the settings.
   - In print settings, the print preview is empty unless I click a element in the template editor.
   - In Void Codes, add an action to the table data where in I can see the details of the void codes and able to change the password and also enable/disable the code.
   - In posadmin main dashboard, fix the resizing feature, currently when I resize any of the cards its overlapping the other cards, make the cards and graph cards relative so they will reposition based on their sizes.
   - In posadmin dashboard -> On-Duty Cashiers, add a button or a trigger to use to message the user directly using the chat feature.
   - In posadmin dashboard -> On-Duty Cashiers, remove the duplicated notification bell and printer settings icon in the below header part, It should be a breadcrumb.
   - Fix the UI issue on cashier dashboard, so that It can be usable weather the system is used on a touchscreen device or a desktop/laptop device.
   - Make sure to fix all errors and bugs you encounter while working on this task.
   - Make sure to check all taskss under this continuation before setting it to done because in the past there are tasks that has not been done so be sure to check if its all done properly and without errors and bugs.

