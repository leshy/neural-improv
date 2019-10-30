import _ from 'lodash'
import { initSync } from 'ribcage2'

const globalAny: any = global
globalAny.performance = Date
globalAny.fetch = require('node-fetch')

// // @ts-ignore
// global.navigator = { userAgent: 'node.js' }
// _.extend(global, require('web-audio-mock-api'))
// require('@tensorflow/tfjs-node-gpu')

import * as Tonal from 'tonal'
// @ts-ignore
import * as easyMidi from 'easymidi'
import * as Model from '@magenta/music/node/music_rnn'
// const core = require('@magenta/music/node/core')

// function detectChord(notes) {
//   notes = notes.map(n => Tonal.Note.pc(Tonal.Note.fromMidi(n.note))).sort()
//   return Tonal.PcSet.modes(notes)
//     .map((mode, i) => {
//       const tonic = Tonal.Note.name(notes[i])
//       const names = Tonal.Dictionary.chord.names(mode)
//       return names.length ? tonic + names[0] : null
//     })
//     .filter(x => x)
// }

// // @ts-ignore
// function generateDummySequence(rnn) {
//   // Generate a throwaway sequence to get the RNN loaded so it doesn't
//   // cause jank later.
//   return rnn.continueSequence(
//     buildNoteSequence([{ note: 60, time: 0 }]),
//     20,
//     1,
//     ['Cm'],
//   )
// }

type Context = {
  rnn?: Model.MusicRNN
  midiOut?: easyMidi.Output
  midiIn?: easyMidi.Input
}

const initRNN = (context: Context): Promise<Context> => {
  // Your code:
  const rnn = new Model.MusicRNN(
    //    'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn',
    //    'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn',
    'https://storage.googleapis.com/download.magenta.tensorflow.org/tfjs_checkpoints/music_rnn/chord_pitches_improv',
  )
  logger.info('Downloading magenta checkpoint...')
  return (
    rnn
      .initialize()
      .then(() => {
        logger.info('Init Neural')
        // return generateDummySequence(rnn)
      })
      // @ts-ignore
      .then(sequence => {
        return _.extend(context, {
          rnn,
        })
      })
  )
}

const initMidi = (context: Context): Promise<Context> =>
  Promise.resolve(
    _.extend(context, {
      midiOut: new easyMidi.Output('neuralOut', true),
      midiIn: new easyMidi.Input('neuralIn', true),
    }),
  )

// @ts-ignore
function detectChord(notes) {
  // @ts-ignore
  notes = notes.map(n => Tonal.Note.pc(Tonal.Note.fromMidi(n))).sort()
  console.log(notes)
  return Tonal.PcSet.modes(notes)
    .map((mode, i) => {
      console.log(mode, i)
      const tonic = Tonal.Note.name(notes[i])
      console.log(tonic)
      // @ts-ignore
      const names = Tonal.Dictionary.chord.names(mode)
      console.log(names)
      console.log('---')
      return names.length ? tonic + names[0] : null
    })
    .filter(x => x)
}

// @ts-ignore
const { conf, logger } = initSync({ verbose: 1 })

const context: Context = {}

// @ts-ignore
function continueSequence(rnn, seed: number[]) {
  // @ts-ignore
  function buildNoteSequence(seed) {
    let step = 0
    // @ts-ignore

    let notes: Note[] = seed.map((n: number) => {
      // let delayProb = 0.3
      // let dur = 1 + (Math.random() < delayProb ? 1 : 0)
      const dur = 1
      let note = {
        pitch: n,
        quantizedStartStep: step,
        quantizedEndStep: step + dur,
      }
      step += dur
      return note
    })

    console.log('built', seed, notes)

    return {
      // @ts-ignore
      totalQuantizedSteps: _.last(notes).quantizedEndStep,
      quantizationInfo: { stepsPerQuarter: 1 },
      notes,
    }
  }

  if (seed.length === 0) {
    return Promise.reject('empty seed')
  }

  const chords = detectChord(seed)
  const chord =
    _.first(chords) || Tonal.Note.pc(Tonal.Note.fromMidi(seed[0])) + 'M'

  logger.info('chord is', chord)
  return rnn.continueSequence(buildNoteSequence(seed), 35, 1, [chord])
}

type Note = {
  pitch: number
  quantizedStartStep: number
  quantizedEndStep: number
}

type Sequence = {
  notes: Note[]
  quantizationInfo: { stepsPerQuarter: number }
}

// @ts-ignore
const playSequence = (midiOut: easyMidi.Output, sequence: Sequence) =>
  new Promise(resolve => {
    logger.info('play', sequence)

    // @ts-ignore
    const stepMs =
      250 / ((sequence.quantizationInfo.stepsPerQuarter * 120) / 60)
    console.log('stepMs', stepMs)

    const play = (notes: Note[]) => {
      const note = notes.shift()
      if (!note) {
        logger.info('Playing Stopped')
        return resolve()
      }
      const { pitch, quantizedStartStep, quantizedEndStep } = note
      const wait = (quantizedEndStep - quantizedStartStep) * stepMs

      // logger.info('PLAY ' + pitch)
      midiOut.send('noteon', {
        note: pitch,
        velocity: 127,
        channel: 0,
      })

      setTimeout(() => {
        midiOut.send('noteoff', {
          note: pitch,
          velocity: 127,
          channel: 0,
        })
        play(notes)
      }, wait)
    }

    setTimeout(() => {
      play(sequence.notes)
    }, stepMs)
  })

initMidi(context)
  .then(initRNN)
  .then(context => {
    // @ts-ignore
    const { rnn, midiOut, midiIn } = context
    const input = [55]
    let playing = false

    logger.info('Running')

    const maybeGenerate = () => {
      if (input.length > 3 && !playing) {
        playing = true
        logger.info('generating')

        const currentInput = [...input]
        _.times(input.length, () => input.pop())

        continueSequence(rnn, currentInput)
          .then((sequence: Sequence) => {
            return playSequence(midiOut, sequence)
          })
          .finally(() => {
            playing = false
            return maybeGenerate()
          })
      }
    }

    // @ts-ignore
    midiIn.on('noteon', function(msg) {
      logger.info('NOTEON', msg)
      input.push(msg.note)
      maybeGenerate()
    })

    // // @ts-ignore
    // midiIn.on('noteoff', function(msg) {
    //   console.log('NOTEOFF', msg)
    // })
  })
