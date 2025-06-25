# was98: most transparently secure wallet

To bootstrap a was98 computer

0. [Install Deno](https://docs.deno.com/runtime/getting_started/installation/)

```
curl -fsSL https://deno.land/install.sh | sh
```

This will allow us to seamlessly share code between your shell and your browser.

1. Run the following command

```
deno -A server.js
```

This will start a static file server in the current directory. It will also include the WAS dependencies, generate a signing key on the server, and inject that into the client.

2. Navigate to http://localhost:8081 in a web browser

You should see two panes. Left with the source code of server.js and right blank. 

3. Click "Run" in the top right

Open the web inspector to the network tab before doing so to get the space url.

```
http://localhost:8080/space/9af36a26-6d6b-4f87-b564-4f5a234b02e6/server.js
```

You should see the source code of server.js served back on the right side as a preview.

4. Run crtl-c against the server.js process

This will stop the server, allowing us to spin up the new server we just published.

5. Run the following command

```
deno -A http://localhost:8080/space/9af36a26-6d6b-4f87-b564-4f5a234b02e6/server.js
```

Just remember to replace the path with the one you just pushed to production.

# Pushing to Production

When ready to scale globally, install deployctl (`deno install -gArf jsr:@deno/deployctl`) and run:

```
./deploy.sh
```
