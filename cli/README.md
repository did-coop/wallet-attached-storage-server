# @data.pub/cli

Command Line Interface (i.e. 'cli') to use [DataPub](https://data.pub).

## Usage

### Get spaces collection

```
$ datapub fetch https://data.pub/spaces/ get
{
  "type": [
    "Collection"
  ],
  "totalItems": 1,
  "items": [
    {
      "type": "Space",
      "id": "urn:uuid:73b75efe-dcb5-4cd7-8179-a35841ad25ea",
      "name": "Space urn:uuid:73b75efe-dcb5-4cd7-8179-a35841ad25ea"
    }
  ]
}
```

### Create a new Collection by sending POST to /spaces/

```shell
$ id="$HOME/.ssh/id_ed25519_public_datapub_dev"
$ controller="$(datapub key "$id" controller)"
$ space='{"controller":"'"$controller"'"}'
$ DATAPUB_SPACE="$(
    echo "$space" \
    | datapub fetch \
        -i "$id" https://data.pub/spaces/ \
        post \
        --content-type 'application/json'
  )"
$ echo "$DATAPUB_SPACE"
https://data.pub/space/7c4d7d9a-4bfd-45df-906c-e24cb34914fa
```

### Get a Space

```shell
$ datapub fetch $DATAPUB_SPACE get
{
  "type": "Space",
  "id": "urn:uuid:a84fef2f-c040-4377-b0b1-438f617d6781",
  "name": "Space urn:uuid:a84fef2f-c040-4377-b0b1-438f617d6781"
}
```

### Set Space Controller

```shell
id="$HOME/.ssh/id_ed25519_public_datapub_dev"
controller="$(datapub key "$id" controller)"
space='{"controller":"'"$controller"'"}'
echo "$space"
| datapub fetch  -i "$id" $DATAPUB_SPACE put -v
```

### Put a file in a Space

```shell
$ cat index.html \
| datapub fetch \
  -i ~/.ssh/id_ed25519_public \
  $DATAPUB_SPACE/resource/index.html \
  put \
  --content-type 'text/html' \
  -v
```

### Get a file in a Space

```shell
$ datapub fetch -i ~/.ssh/id_ed25519_public $DATAPUB_SPACE/resource/index.html get -v
```

### Get `did:key` DID URL for Ed25519 SSH key

```
$ datapub key ~/.ssh/id_ed25519
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

### Sign data with Ed25519 SSH key

```
$ datapub \
  key ~/.ssh/id_ed25519 \
  sign 'data to sign'
data:base64,oAww3mQVMqhEd8t6DkfyaC4PA1gP5DpNOODs748hCR56oEngDIE445x6OHPlLCJkmu4tK8z2BAPn2O/TR+ArCg==
```
