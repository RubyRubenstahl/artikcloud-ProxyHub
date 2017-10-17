# ARTIK Cloud Proxy Hub

ARTIK Cloud Proxy Hub application is a hub that can link to ARTIK Cloud multiple devices present in your area.

@TODO Use Proxy Hub code in three ways (aka why do you need Proxy Hub) ===

ARTIK Cloud Proxy Hub is already compatible with multiple devices (Wemo, Shell command...) but you can extend it adding some new proxies that are able to talk to new devices.

## Requirements

- [node](https://nodejs.org/en/download/)  (Version >= 6.5.0????) <<@TODO
- [npm](https://www.npmjs.com/get-npm) (Version >= 3.10.0????)

## Setup / Installation

 - In order to setup your Proxy hub we recommend you to use a fix IP
 - Required NodeJS: node and npm, https://nodejs.org/en/
 - Unzip the ARTIKCloudProxyHub.zip
 - Go to the ARTIKCloudProxyHub folder
 - Run "npm install" (can take up to 1h on a slow computer)

# Demo

 1. Run "npm start". After the server is started you will be able to read this line:
"GO TO THIS WEBPAGE TO ACCESS THE UI: <url>"
 2. Open a browser and go to the url.
 3. The ui will guide you to set up you proxy hub. @TODO highlevel what will be setup in app level

@TODO: different workflow for device discoverable and no discoverable....


# Restart the server
- If you stop the server you can restart it using "npm start"

# Add a new proxy to ARTIK Cloud Proxy Hub
To add a new proxy add his folder to the `/proxies` folder.
Proxies with a folder starting with '_' are not loaded.
_template folder contains an example of what you need to do to create a proxy

## More about ARTIK Cloud

If you are not familiar with ARTIK Cloud, we have extensive documentation at https://developer.artik.cloud/documentation

The full ARTIK Cloud API specification can be found at https://developer.artik.cloud/documentation/api-spec

Check out sample applications at https://developer.artik.cloud/documentation/tutorials/

To create and manage your services and devices on ARTIK Cloud, create an account at https://developer.artik.cloud

Also see the ARTIK Cloud blog for tutorials, updates, and more: http://artik.io/blog/cloud

## License and Copyright

Licensed under the Apache License. See [LICENSE](LICENSE).

Copyright (c) 2017 Samsung Electronics Co., Ltd.

