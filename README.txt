REGIONAL AUTOSELECTIONS ADMIN
============================

1. Replace your existing adminregional folder with this folder.
2. Keep the supplied assets/logo.jpg and assets/background.jpg if you have them.
3. Run supabase.sql in Supabase SQL Editor.
4. Create an admin user in Supabase Dashboard > Authentication > Users.
5. Make the car-images Storage bucket PUBLIC, or configure Storage policies.
6. Serve this folder through VS Code Live Server. Do not open HTML directly as file://.
7. Login at auth.html.
8. Listings is the default admin page.
9. Edit uses ?id=<cars.id> and car_images/car-images.

IMPORTANT:
The supplied Supabase publishable key is safe to expose in frontend code when RLS is correctly configured.
NEVER put the PostgreSQL connection string or database password in HTML/JS.
The app does not implement "any password works"; Supabase Auth requires a real user account.
