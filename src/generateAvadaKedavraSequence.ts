function generateAvadaKedavraSequence(numberOfApps: number): string[] {
    let sequence: string[] = ['home', 'delay=100', 'home', 'delay=800'];
    for (let i = 0; i < numberOfApps; i++) {
        sequence = sequence.concat(['up', 'delay=50', 'up', 'delay=600']);
    }
    sequence.push('home');
    return sequence;
}

export default generateAvadaKedavraSequence;