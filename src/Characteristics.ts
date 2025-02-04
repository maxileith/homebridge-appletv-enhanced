
import type { HAP, Characteristic, CharacteristicProps } from 'homebridge';
import { Formats, Perms, Units } from 'homebridge';
import { camelCaseToTitleCase } from './utils';
import { PyATVCustomCharacteristicID } from './enums';

const STRING_CHARACTERISTIC_PROPS: CharacteristicProps = {
    format: Formats.STRING,
    perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    maxLen: 256,
};

const NUMBER_CHARACTERISTIC_PROPS: CharacteristicProps = {
    format: Formats.UINT32,
    perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    minStep: 1,
};


export function newPyatvCharacteristic(hap: HAP, char: PyATVCustomCharacteristicID): Characteristic {
    let props: CharacteristicProps | undefined = undefined;
    switch (char) {
        case PyATVCustomCharacteristicID.ALBUM:
        case PyATVCustomCharacteristicID.ARTIST:
        case PyATVCustomCharacteristicID.CONTENT_IDENTIFIER:
        case PyATVCustomCharacteristicID.GENRE:
        case PyATVCustomCharacteristicID.OUTPUT_DEVICES:
        case PyATVCustomCharacteristicID.SERIES_NAME:
        case PyATVCustomCharacteristicID.TITLE:
            props = STRING_CHARACTERISTIC_PROPS;
            break;
        case PyATVCustomCharacteristicID.REPEAT:
            props = { ...STRING_CHARACTERISTIC_PROPS, maxLen: 5 };
            break;
        case PyATVCustomCharacteristicID.SHUFFLE:
            props = { ...STRING_CHARACTERISTIC_PROPS, maxLen: 6 };
            break;
        case PyATVCustomCharacteristicID.EPISODE_NUMBER:
        case PyATVCustomCharacteristicID.SEASON_NUMBER:
        case PyATVCustomCharacteristicID.ITUNES_STORE_IDENTIFIER:
            props = NUMBER_CHARACTERISTIC_PROPS;
            break;
        case PyATVCustomCharacteristicID.POSITION:
        case PyATVCustomCharacteristicID.TOTAL_TIME:
            props = { ...NUMBER_CHARACTERISTIC_PROPS, unit: Units.SECONDS };
            break;
    }
    return new hap.Characteristic(camelCaseToTitleCase(char), hap.uuid.generate(`uuid-${char}`), props);
}

export function newStringCharacteristic(hap: HAP, name: string): Characteristic {
    return new hap.Characteristic(name, hap.uuid.generate(`uuid-${name}`), STRING_CHARACTERISTIC_PROPS);
}
