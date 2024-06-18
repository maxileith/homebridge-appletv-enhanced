import sys
import os
import re
import json
import requests
from packaging.version import parse as parse_version
from github import Github, Auth

GH_TOKEN = os.environ["GH_TOKEN"]
package_json = ""


def check_logs(b: str) -> list[str]:
    logs = b.split("### Logs", 1)[1].split('### Configuration')[0].strip()

    output = []

    # if "[I] Platform: Finished initializing platform: Apple TV Enhanced" not in logs:
    #     output.append("Provide the **logs from the start** of the plugin, starting with `[I] Platform: Finished initializing platform: Apple TV Enhanced`")
    
    if "[D]" not in logs:
        output.append("Enable **debug logging** (loglevel 4)")
    
    return output


def check_config(b: str) -> list[str]:
    conf = b.split("### Configuration", 1)[1].split('### Operating System')[0].strip()[7:-3].strip()

    output = []

    try:
        json.loads(conf)
    except json.decoder.JSONDecodeError:
        output.append("The configuration is **no valid JSON**")
    
    return output


def check_os(b: str) -> list[str]:
    operating_system = b.split("### Operating System", 1)[1].split('### Operating System: Bits')[0].strip()

    output = []

    if operating_system != "Linux":
        output.append(f"Only **Linux** is supported as an operating system (see [requirements](https://github.com/maxileith/homebridge-appletv-enhanced#requirements)). Your current OS is {operating_system}.")
    
    output += check_os_bits(b)

    return output


def check_os_bits(b: str) -> list[str]:
    operating_system_bits = b.split("### Operating System: Bits", 1)[1].split('### Operating System: Distribution')[0].strip()

    output = []

    if operating_system_bits != "64-bit":
        output.append(f"Only **64-bit** architectures are supported. Your current architecture is {operating_system_bits}.")
    
    return output


def check_docker(b: str) -> list[str]:
    docker = b.split("### Docker", 1)[1].split('### Docker Image')[0].strip()

    output = []

    if docker != "no":
        output += check_docker_image(b)
        output += check_docker_image_version(b)
    
    return output


def check_docker_image(b: str) -> list[str]:
    image = b.split("### Docker Image", 1)[1].split('### Docker Image Tag')[0].strip()

    output = []

    if image != "homebridge/homebridge":
        output.append(f"Only the docker image **homebridge/homebridge** from [Docker Hub](https://hub.docker.com/r/homebridge/homebridge/) is supported. You are currently using {image}.")
    
    return output


def check_docker_image_version(b: str) -> list[str]:
    version = b.split("### Docker Image Tag", 1)[1].split('### Homebridge Version')[0].strip()

    output = []

    tag_regex = re.compile("^\d{4}-\d{2}-\d{2}$")

    if version == "latest":
        output.append("Please specify the **distinct image tag** (not `latest`), e.g. `2024-01-08`")
    elif not tag_regex.match(version):
        output.append("Please provide a tag that matches the pattern of the tagging strategy of homebridge/homebridge, e.g. `2024-01-08`")
    else:
        tags = get_all_docker_tags()
        latest_digest = list(filter(lambda e: e["name"] == 'latest', tags))[0]["digest"]
        if version not in map(lambda e: e["name"], tags):
            output.append(f"The **tag `{version}` does not exist** for the docker image homebridge/homebridge from Docker Hub. Please provide an actual image tag.")
        elif latest_digest != list(filter(lambda e: e["name"] == version, tags))[0]["digest"]:
            latest_aliases = filter(lambda e: e["digest"] == latest_digest, tags)
            latest_version = list(filter(lambda e: tag_regex.match(e["name"]), latest_aliases))[0]["name"]
            output.append(f"The docker tag `{version}` is not the latest one. Please **update your docker container to image version [`{latest_version}`](https://hub.docker.com/r/homebridge/homebridge/tags?page=1&name={latest_version})**")

    return output


def get_all_docker_tags() -> list:
    response = requests.get("https://hub.docker.com/v2/repositories/homebridge/homebridge/tags?page_size=10000000", timeout=10)
    return response.json()["results"]


def check_homebridge_version(b: str) -> list[str]:
    version = b.split("### Homebridge Version", 1)[1].split('### Homebridge Config UI Version')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+(-(beta|alpha)\.\d+)?$")

    if not version_pattern.match(version):
        output.append(f"The Homebridge version {version} does not match the expected version pattern of Homebridge. Please provide a version that exists.")
    else:
        min_homebridge_version = package_json["engines"]["homebridge"][1:]
        if parse_version(downgrade_version_to_next_non_prerelease(version)) < parse_version(min_homebridge_version):
            output.append(f"The current version of Apple TV Enhanced **requires Homebridge version `{min_homebridge_version}`**. You have installed version {version}.")
        if version not in get_all_npm_package_versions('homebridge'):
            output.append(f"Homebridge version {version} does not exist. Please **provide a Homebridge version that exists**.")

    return output


def check_homebridge_config_ui_version(b: str) -> list[str]:
    version = b.split("### Homebridge Config UI Version", 1)[1].split('### Homebridge Storage Path')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+(-(beta|alpha)\.\d+)?$")

    if not version_pattern.match(version):
        output.append(f"The Homebridge Config UI version {version} does not match the expected version pattern of Homebridge Config UI. Please provide a version that exists.")
    else:
        if parse_version(downgrade_version_to_next_non_prerelease(version)) < parse_version('4.54.2'):
            output.append(f"The current version of Apple TV Enhanced **requires Homebridge Config UI version `4.54.2`**. You have installed version {version}.")
        if version not in get_all_npm_package_versions('homebridge-config-ui-x'):
            output.append(f"Homebridge Config UI version {version} does not exist. Please **provide a Homebridge Config UI version that exists**.")

    return output


def get_all_npm_package_versions(package: str) -> list[str]:
    response = requests.get(f"https://registry.npmjs.org/{package}", timeout=10)
    versions = list(response.json()["versions"].keys())
    return versions


def check_storage_path(b: str) -> list[str]:
    path = b.split("### Homebridge Storage Path", 1)[1].split('### Homebridge Apple TV Enhanced Version')[0].strip()

    path_pattern = re.compile("^(\/([a-zA-Z0-9_\-\.]|\\\\\s)+)+$")

    output = []

    if not path_pattern.match(path):
        output.append(f"The path `{path}` is no valid absolute path. Please provide the homebridge storage **absolute** path.")

    return output


def check_homebridge_appletv_enhanced_version(b: str) -> list[str]:
    version = b.split("### Homebridge Apple TV Enhanced Version", 1)[1].split('### Node Version')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+(-\d+)?$")

    if not version_pattern.match(version):
        output.append(f"The Homebridge Apple TV Enhanced version {version} does not match the expected version pattern of Homebridge Apple TV Enhanced. Please provide a version that exists.")
    else:
        latest_homebridge_version = package_json["version"]

        if version not in get_all_npm_package_versions('homebridge-appletv-enhanced'):
            output.append(f"Homebridge Apple TV Enhanced version {version} does not exist. Please **provide a Homebridge Apple TV Enhanced version that exists**.")
        if parse_version(downgrade_version_to_next_non_prerelease(version)) < parse_version(latest_homebridge_version):
            output.append(f"Please use the **latest Homebridge Apple TV Enhanced version {latest_homebridge_version}**. You are currently using version {version}.")

    return output


def check_node_version(b: str, github) -> list[str]:
    version = b.split("### Node Version", 1)[1].split('### NPM Version')[0].strip()

    if version[0].lower() != "v":
        version = f"v{version}"

    output = []

    version_pattern = re.compile("^v\d+\.\d+\.\d+?$")

    if not version_pattern.match(version):
        output.append(f"The Node version {version} does not match the expected version pattern of Node. Please provide a version that exists.")
    else:
        repo = github.get_repo("nodejs/node")
        tags = repo.get_tags()

        tag_exists = False
        for tag in tags:
            if tag.name == version:
                tag_exists = True
                break

        if not tag_exists:
            output.append(f"Node version {version} does not exist. Please **provide a Node version that exists**.")

        accepted_versions = package_json["engines"]["node"].split(' || ')
        accepted_versions = list(map(lambda e: e[1:], accepted_versions))
        version_valid = False
        for av in accepted_versions:
            major, _, _ = av.split('.', 2)
            max_major = str(int(major) + 1)
            if (parse_version(version) < parse_version(max_major) and parse_version(version) >= parse_version(av)):
                version_valid = True
                break

        if not version_valid:
            output.append(f"Node Version {version} is not supported. It should be an up-to-date LTS version: {' or '.join(accepted_versions)}")

    return output


def check_npm_version(b: str) -> list[str]:
    version = b.split("### NPM Version", 1)[1].split('### Python Version')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+$")

    if not version_pattern.match(version):
        output.append(f"The NPM version {version} does not match the expected version pattern of NPM. Please provide a version that exists.")
    elif version not in get_all_npm_package_versions('npm'):
        output.append(f"NPM version {version} does not exist. Please **provide a NPM version that exists**.")

    return output


def check_python_version(b: str) -> list[str]:
    version = b.split("### Python Version", 1)[1].split('### PIP Version')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+\.\d+$")
    if not version_pattern.match(version):
        output.append(f"The Python version {version} does not match the expected version pattern of Python. Please provide a version that exists.")
    else:
        accepted_versions = []
        with open("src/PythonChecker.ts", "r", encoding="utf-8") as f:
            content = f.read()
            # extract the lines where the versions are specified
            content = content.split("const SUPPORTED_PYTHON_VERSIONS: string[] = [", 1)[1].split("];", 1)[0]
            # remove line breaks and spaces
            content = content.replace("\n", "")
            content = content.replace(" ", "")
            # split to get the versions individually
            accepted_versions = content[1:-2].split("','")

        valid_version = False
        for av in accepted_versions:
            if version.startswith(f"{av}."):
                valid_version = True
                break

        if not valid_version:
            output.append(f"Your Python version {version} is not supported. Please **install a supported Python version**, e.g. {accepted_versions[-1]}")

    return output


def check_pip_version(b: str) -> list[str]:
    version = b.split("### PIP Version", 1)[1].split('### HDMI Hops')[0].strip()

    if version[0].lower() == "v":
        version = version[1:]

    output = []

    version_pattern = re.compile("^\d+\.\d+(\.\d+)?$")

    if not version_pattern.match(version):
        output.append(f"The PIP version {version} does not match the expected version pattern of PIP. Please provide a version that exists.")

    return output


def check_audio_output(b: str) -> list[str]:
    audio_output = b.split("### Audio Output", 1)[1].split('### Same Subnet')[0].strip()

    output = []

    if audio_output != "no":
        output.append("External audio outputs are not supported by the plugin as explained in the [known issues](https://github.com/maxileith/homebridge-appletv-enhanced?tab=readme-ov-file#known-issues).")

    return output


def check_same_subnet(b: str) -> list[str]:
    same_subnet = b.split("### Same Subnet", 1)[1].split('### Additional Context')[0].strip()

    output = []

    if same_subnet != "yes":
        output.append("It is required to have the Apple TV on the same subnet as the Homebridge instance as written in the [requirements](https://github.com/maxileith/homebridge-appletv-enhanced#requirements).")

    return output


def downgrade_version_to_next_non_prerelease(version: str) -> str:
    if '-' in version:
        version = version.split('-', 1)[0]
        major, minor, patch = version.split('.', 2)
        patch = str(int(patch) - 1)
        version = f"{major}.{minor}.{patch}"
    return version


def hide_outdated_comments(issue):
    for comment in issue.get_comments():
        if comment.user.login == "github-actions[bot]" and ("## ✔️ Take a coffee ☕" in comment.body or "## ❗ Action required" in comment.body):
            comment.delete()


if __name__ == "__main__":
    issue_id = int(sys.argv[1])

    with open("package.json", "r", encoding="utf-8") as f:
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
    todos += check_homebridge_appletv_enhanced_version(b)
    todos += check_node_version(b, g)
    todos += check_npm_version(b)
    todos += check_python_version(b)
    todos += check_pip_version(b)
    todos += check_audio_output(b)
    todos += check_same_subnet(b)

    valid = len(todos) == 0

    print("---- Comment ----")

    if valid:
        md = "## ✔️ Have a coffee ☕\n\n"
        md += "Your opened issue fulfills all requirements validated in the pre-checks 🎉\n\n"
        md += "My master will take a look at the problem as soon as he has the time for it 🤖\n\n"
        md += "Time to get a coffee ☕"
    else:
        md = "## ❗ Action required\n\n"
        md += "There are a few problems with your opened issue. Please fix them by editing the issue:\n\n"
        for todo in todos:
            md += f"- {todo}\n"
        md += "\nOften the problem you are experiencing will be solved by simply making your environment compliant with the requirements (fulfilling the pre-checks).\n\n"
        md += "## 🔁 Rerun\n\n"
        md += "After editing the issue, the checks will be run again.\n\n"
        md += "**Under no circumstances** should the issue be adjusted untruthfully. If the issue cannot fulfill the pre-checks, your environment is simply not supported.\n\n"
        md += "If you do not adjust the issue accordingly, the issue will be **automatically closed after 60 days of inactivity**."

    print(md)

    print("---- Comment ----")

    hide_outdated_comments(i)

    i.create_comment(md)

    try:
        if valid:
            print("removing the \"bad request\" label")
            i.remove_from_labels("bad request")
        else:
            print("adding the \"bad request\" label")
            i.add_to_labels("bad request")
    except Exception:
        pass

    g.close()
