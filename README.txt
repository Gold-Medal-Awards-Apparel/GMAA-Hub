GOLD MEDAL HUB (GMAA) - desktop app, version 0.9.1 (Order History module, old-store data)

TO SET UP ON THIS COMPUTER
1. Double-click "Start Gold Medal Hub.bat".
   - If Node.js (free) is missing, it installs it, then asks you to run the file again.
   - First run downloads the app's components (a few minutes, one time).
   - It then asks whether to put a Gold Medal Hub icon on the Desktop (Yes is the default after 20 seconds).
     It also adds a Start-menu entry, so you can press the Windows key and type "Gold Medal" or "GMAA".
2. When the app opens it asks for the data file. Choose OrderHistory-OldStore.json (in the "data-private" folder).
   The app keeps its own copy. You do this once.

IF THE DESKTOP ICON IS MISSING: double-click "Create Desktop Icon.bat" (it shows any error in red).

TO UPDATE LATER: download the new zip, close the app, double-click "Update Gold Medal Hub.bat" (copy it into this folder once).

AFTER THAT: open it from the Desktop icon or the Windows search. The .bat is only needed for setup.

WHERE THINGS ARE SAVED
Data copy: %APPDATA%\order-history-search\data\old-store.json  (stays through app updates)

FILES
main.js / preload.js   - app shell and safe file access
renderer\              - the screen (index.html, app.js, boot.js, logo.png)
assets\                - icon
tools\                 - shortcut creator
OrderHistory-OldStore.json - old-store data (customer names and prices - keep private)

NEW IN 0.6.0 - ORDER BOARD + SHARED NOTES
See SHARED-DATABASE-SETUP.txt. Board columns match the shop whiteboard colors; notes show who wrote them and
new ones pop up when someone opens the app. No logins: pick your name under "Working as".

NEW IN 0.5.0 - PRICE CHECK
Click "Price check", type what you are pricing (abbreviations work). It shows what customers paid (low/median/high,
by quantity and by year) next to the current store price from Shopify. Needs the read_products permission on the
Shopify app; click "Update store prices" after adding it.

NEW IN 0.4.0 - CUSTOMERS TAB
Click "Customers" at the top. Ranks everyone by money spent, groups by organization or contact person,
shows segments (School, Fire/EMS/Police, Business, ...), and a detail panel with yearly sales, top items and
prices paid. If a segment guess is wrong, open the customer and pick the right one; it is remembered.

NEW IN 0.3.1 - NEW-STORE ORDERS FROM SHOPIFY
- File > Shopify connection (or the gear button): enter the store address (xxx.myshopify.com), Client ID and Client secret
  from your Shopify Dev Dashboard app. The secret is stored encrypted on this computer and is only used to READ orders.
- "Sync new orders" gets the newest orders. It also runs by itself when the app opens if the last sync is over 6 hours old.
  Offline? It just skips and everything already downloaded stays searchable.
- New-store orders show as "New #1234" and old ones as "Old #1234". Click a New # or a New customer name to open it in Shopify
  (you may have to sign in to Shopify first). A "Store" drop-down filters Old / New / both.
- To update an existing copy: unzip this over your current folder and choose "Replace". Your data and shortcuts are untouched.

Built by WiseFaro for Gold Medal Awards & Apparel.


INVENTORY (v0.9.0)
- Inventory tab: scan a barcode (the vendor item number) into the big box and press Enter (a keyboard-style scanner does this for you).
- Modes: Look up, Use (-), Receive (+), Count. In Use/Receive mode an item with one line changes straight away; items with several colors/sizes open a list so you pick the line.
- The first time, click "Load my spreadsheet list" (admin) to fill the shared database from inventory-seed.json. It only works while the inventory is empty.
- Everyone's changes are saved in the shared Cloudflare database with the signed-in person's name (History shows who did what).
