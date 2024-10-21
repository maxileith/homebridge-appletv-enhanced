
import type { HAP, Characteristic, CharacteristicProps } from 'homebridge';
import { Formats, Perms, Units } from 'homebridge';
import { camelCaseToTitleCase } from './utils';
import { PyatvCustomCharacteristicID } from './enums';

const STRING_CHARACTERISTIC_PROPS: CharacteristicProps = {
    format: Formats.STRING,
    perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    maxLen: 64,
};

const NUMBER_CHARACTERISTIC_PROPS: CharacteristicProps = {
    format: Formats.UINT32,
    perms: [Perms.PAIRED_READ, Perms.NOTIFY],
};


export default function newCharacteristic(hap: HAP, char: PyatvCustomCharacteristicID): Characteristic {
    let props: CharacteristicProps | undefined = undefined;
    switch (char) {
        case PyatvCustomCharacteristicID.ALBUM:
        case PyatvCustomCharacteristicID.ARTIST:
        case PyatvCustomCharacteristicID.GENRE:
        case PyatvCustomCharacteristicID.SERIES_NAME:
        case PyatvCustomCharacteristicID.TITLE:
            props = STRING_CHARACTERISTIC_PROPS;
            break;
        case PyatvCustomCharacteristicID.REPEAT:
            props = { ...STRING_CHARACTERISTIC_PROPS, maxLen: 5 };
            break;
        case PyatvCustomCharacteristicID.SHUFFLE:
            props = { ...STRING_CHARACTERISTIC_PROPS, maxLen: 6 };
            break;
        case PyatvCustomCharacteristicID.EPISODE_NUMBER:
        case PyatvCustomCharacteristicID.SEASON_NUMBER:
            props = NUMBER_CHARACTERISTIC_PROPS;
            break;
        case PyatvCustomCharacteristicID.POSITION:
        case PyatvCustomCharacteristicID.TOTAL_TIME:
            props = { ...NUMBER_CHARACTERISTIC_PROPS, unit: Units.SECONDS };
            break;
    }
    return new hap.Characteristic(camelCaseToTitleCase(char), hap.uuid.generate(char), props);
}
