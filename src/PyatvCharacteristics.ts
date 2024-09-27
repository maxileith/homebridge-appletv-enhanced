
import type { HAP, Characteristic} from 'homebridge';
import { Formats, Perms, Units } from 'homebridge';
import type { TPyatvCharacteristicID, TPyatvCharacteristicGenerator } from './types';


function albumPyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Album', '56a01f2d-23e1-4cd9-bf9b-23d7921fb889', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function artistPyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Artist', '41afaebb-5418-42bd-ab01-017498b98311', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function episodePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Episode', '5628da35-33b4-413c-b3b6-00bc61dca1ab', {
        format: Formats.UINT32,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    })
}


function genrePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Genre', '0d9c716b-3c7f-4085-bd0e-68efc3a0a987', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}


function repeatPyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Repeat', '41367238-c5c9-4533-bcaf-b819fac0e566', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function seasonPyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Season', 'b131bea3-ebc0-477f-9d0b-552e0a6163a9', {
        format: Formats.UINT32,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    })
}

function seriesNamePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Series Name', '7c6733ab-c0e6-4c12-9c73-16791ea0d6aa', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function shufflePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Shuffle', 'd2e8f289-69a3-4580-a406-d3e95d5b5b9b', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function titlePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Title', '8ab927b9-c6d1-4147-822c-6c2141cd3026', {
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        maxLen: 64,
    })
}

function totalTimePyatvCharacteristic(hap: HAP): Characteristic {
    return new hap.Characteristic('Total Time', 'f8b92a6a-bd42-41b6-ac74-41764a6f9534', {
        format: Formats.UINT32,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        unit: Units.SECONDS,
    })
}

const pyatvCharacteristicGenerators: Record<TPyatvCharacteristicID, TPyatvCharacteristicGenerator> = {
    'album': albumPyatvCharacteristic,
    'artist': artistPyatvCharacteristic,
    'episodeNumber': episodePyatvCharacteristic,
    'genre': genrePyatvCharacteristic,
    'repeat': repeatPyatvCharacteristic,
    'seasonNumber': seasonPyatvCharacteristic,
    'seriesName': seriesNamePyatvCharacteristic,
    'shuffle': shufflePyatvCharacteristic,
    'title': titlePyatvCharacteristic,
    'totalTime': totalTimePyatvCharacteristic,
}

export default pyatvCharacteristicGenerators;
