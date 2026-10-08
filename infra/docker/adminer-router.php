<?php
// Adminer is served under /db/ by the proxy. Routing every request to index.php keeps the /db/
// prefix in REQUEST_URI, so the links Adminer builds stay under /db/.
chdir('/var/www/html');
require '/var/www/html/index.php';
