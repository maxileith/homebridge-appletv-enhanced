import sys
import os
import re
import json
import requests
from packaging.version import parse as parse_version
from github import Github, Auth

GH_TOKEN = os.environ['GH_TOKEN']
package_json = ""


def check_logs(b: str) -> list[str]:
    logs = b.split("### Logs", 1)[1].split('### Configuration')[0].strip()

    output = []

    if ("[I] Platform: Finished initializing platform: Apple TV Enhanced" not in logs):
        output.append("Provide the **logs from the start** of the plugin, starting with `[I] Platform: Finished initializing platform: Apple TV Enhanced`")
    
    if ("[D]" not in logs):
        output.append("Enable **debug logging** (loglevel 4)")
    
    return output


def check_config(b: str) -> list[str]:
    conf = b.split("### Configuration", 1)[1].split('### Operating System')[0].strip()

    output = []

    try:
        json.loads(conf)
    except json.decoder.JSONDecodeError:
        output.append("The configuration is **no valid JSON**")
    
    return output


def check_os(b: str) -> list[str]:
    operating_system = b.split("### Operating System", 1)[1].split('### Operating System: Bits')[0].strip()

    output = []

    if (operating_system != "Linux"):
        output.append("Only **Linux** is supported as an operating system (see [requirements](https://github.com/maxileith/homebridge-appletv-enhanced#requirements))")
    
    output += check_os_bits(b)

    return output


def check_os_bits(b: str) -> list[str]:
    operating_system_bits = b.split("### Operating System: Bits", 1)[1].split('### Operating System: Distribution')[0].strip()

    output = []

    if (operating_system_bits != "64-bit"):
        output.append("Only **64-bit** architectures are supported.")
    
    return output


def check_docker(b: str) -> list[str]:
    docker = b.split("### Docker", 1)[1].split('### Docker Image')[0].strip()

    output = []

    if (docker != "no"):
        output += check_docker_image(b)
        output += check_docker_image_version(b)
    
    return output


def check_docker_image(b: str) -> list[str]:
    image = b.split("### Docker Image", 1)[1].split('### Docker Image Version')[0].strip()

    output = []

    if (image != "homebridge/homebridge"):
        output.append("Only the docker image **homebridge/homebridge** from [Docker Hub](https://hub.docker.com/r/homebridge/homebridge/) is supported.")
    
    return output


def check_docker_image_version(b: str) -> list[str]:
    version = b.split("### Docker Image Version", 1)[1].split('### Homebridge Version')[0].strip()

    output = []

    tag_regex = re.compile("^\d{4}-\d{2}-\d{2}$")

    if (version == "latest"):
        output.append("Please specify the **distinct image tag** (not `latest`), e.g. `2024-01-08`")
    elif (not tag_regex.match(version)):
        output.append("Please a tag that matches the pattern of the tagging strategy of homebridge/homebridge, e.g. `2024-01-08`")
    else:
        tags = get_all_docker_tags()
        latest_digest = list(filter(lambda e: e['name'] == 'latest', tags))[0]['digest']
        if (version not in map(lambda e: e['name'], tags)):
            output.append(f"The **tag `{version}` does not exist** on homebridge/homebridge. Please provide an actual image tag.")
        elif (latest_digest != list(filter(lambda e: e['name'] == version, tags))[0]['digest']):
            latest_aliases = filter(lambda e: e['digest'] == latest_digest, tags)
            latest_version = list(filter(lambda e: tag_regex.match(e['name']), latest_aliases))[0]['name']
            output.append(f"The docker tag `{version}` is not the latest one. Please **update your docker container to image version `{latest_version}`**")

    return output


def check_homebridge_version(b: str) -> list[str]:
    version = b.split("### Homebridge Version", 1)[1].split('### Homebridge Config UI Version')[0].strip()

    if (version[0].lower() == "v"):
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+$")

    if (not version_pattern.match(version)):
        output.append(f"The Homebridge version {version} does not match the expected version pattern of Homebridge.")
    else:
        min_homebridge_version = package_json['engines']['homebridge'][1:]

        if (parse_version(version) < parse_version(min_homebridge_version)):
            output.append(f"The current version of Apple TV Enhanced **requires Homebridge version `{min_homebridge_version}`**. You have installed version {version}.")

    return output


def check_homebridge_config_ui_version(b: str) -> list[str]:
    version = b.split("### Homebridge Config UI Version", 1)[1].split('### Homebridge Storage Path')[0].strip()

    if (version[0].lower() == "v"):
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+$")

    if (not version_pattern.match(version)):
        output.append(f"The Homebridge Config UI version {version} does not match the expected version pattern of Homebridge Config UI.")
    elif (parse_version(version) < parse_version('4.54.2')):
        output.append(f"The current version of Apple TV Enhanced **requires Homebridge Config UI version `4.54.2`**. You have installed version {version}.")

    return output


def check_storage_path(b: str) -> list[str]:
    path = b.split("### Homebridge Storage Path", 1)[1].split('### Homebridge Apple TV Enhanced Version')[0].strip()

    path_pattern = re.compile("^(\/([a-zA-Z0-9_\-]|\\\\\s)+)+$")

    output = []

    if (not path_pattern.match(path)):
        output.append(f"The path `{path}` is no valid absolute path. Please provide the homebridge storage **absolute** path.")

    return output


def get_all_docker_tags() -> list:
    response = requests.get("https://hub.docker.com/v2/repositories/homebridge/homebridge/tags?page_size=10000000")
    return response.json()['results']


if __name__ == "__main__":
    issue_id = int(sys.argv[1])

    with open('package.json', 'r') as f:
        package_json = json.loads(f.read())

    auth = Auth.Token(GH_TOKEN)
    g = Github(auth=auth)
    r = g.get_repo("maxileith/homebridge-appletv-enhanced")
    i = r.get_issue(issue_id)
    b = i.body

    todos = []

    todos += check_logs(b)
    todos += check_config(b)
    todos += check_os(b)
    todos += check_docker(b)
    todos += check_homebridge_version(b)
    todos += check_homebridge_config_ui_version(b)
    todos += check_storage_path(b)

    print("---- Comment ----")

    md = "There are a few problems with your opened issue. Please fix them by editing the issue:\n\n"
    for todo in todos:
        md += f"- {todo}\n"

    print(md)

    g.close()
