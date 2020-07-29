'use strict'

const _ = require('lodash')
const util = require('util')

class Alarm {
  constructor(alarm,region) {
    this.apigw = alarm.apigw
    this.topic = alarm.topic
    this.region = region
    this.thresholds = alarm.thresholds
    this.name = alarm.name
    this.treatMissingData = alarm.treatMissingData
  }

  formatAlarmName (value) {
    // Cloud Watch alarms must be alphanumeric only
    let apigw = this.apigw.replace(/[^0-9a-z]/gi, '')
    return util.format(apigw + 'MessageAlarm%s', value)
  }

  resolveTreatMissingData (index) {
    if (this.treatMissingData.constructor === Array) {
      return this.validateTreatMissingData(this.treatMissingData[index])
    } else {
      return this.validateTreatMissingData(this.treatMissingData)
    }
  }

  validateTreatMissingData (treatment) {
    let validTreamtments = ['missing', 'ignore', 'breaching', 'notBreaching']
    if (validTreamtments.includes(treatment)) {
      return treatment
    }
  }

  resourceProperties (value) {
    if (value instanceof  Object) {
      return value
    }

    return {
      value
    }
  }
  ressources () {
    return this.thresholds.map(
      (props, i) => {
        const properties = this.resourceProperties(props)

        const config = {
          [this.formatAlarmName(properties.value)]: {
            Type: 'AWS::CloudWatch::Alarm',
            Properties: {
              AlarmDescription: 'Triggers an alarm if availability drops below 99.9%',
              Metrics: [{
                Id: 'e1',
                Label: 'Success Rate',
                Expression: '100-100*(m1/m2)'
              },
              { Id: 'm1',
                Label: '5XX-error-rate',
                MetricStat:{
                  Metric: {
                    MetricName: '5XXError',
                    Namespace: 'AWS/ApiGateway',
                    Dimensions:[ {
                      Name: 'ApiName',
                      Value: '${self:provider.stage}-${self:service}'
                    }, 
                    {
                      Name: 'Stage',
                      Value: '${self:provider.stage}'
                    }
                  ],
                  },
                  Stat: 'Sum',
                  Period: '900'
                },
                ReturnData: 'false'
              },
              {
                Id: 'm2',
                Label: 'count',
                MetricStat:{
                  Metric: {
                    MetricName: 'Count',
                    Namespace: 'AWS/ApiGateway',
                    Dimensions:[ {
                      Name: 'ApiName',
                      Value: '${self:provider.stage}-${self:service}'
                    }, 
                    {
                      Name: 'Stage',
                      Value: '${self:provider.stage}'
                    }
                  ],
                  },
                  Stat: 'Sum',
                  Period: '900'
                },
                ReturnData: 'false'
              },
            ],
              EvaluationPeriods: properties.evaluationPeriods || 1,
              Threshold: properties.value,
              ComparisonOperator: 'LessThanOrEqualToThreshold',
              AlarmActions: [
                { 'Fn::Join': [ '', [ 'arn:aws:sns:' + this.region + ':', { 'Ref': 'AWS::AccountId' }, ':' + this.topic ] ] }
              ],
              OKActions: [
                { 'Fn::Join': [ '', [ 'arn:aws:sns:' + this.region + ':', { 'Ref': 'AWS::AccountId' }, ':' + this.topic ] ] }
              ]
            }
          }
        }
        if (this.name) {
          config[this.formatAlarmName(properties.value)].Properties.AlarmName = util.format('%s-%s-%d', this.name, this.apigw, properties.value)
        }
        if (this.treatMissingData) {
          let treatMissing = this.resolveTreatMissingData(i)
          if (treatMissing) {
            config[this.formatAlarmName(properties.value)].Properties.TreatMissingData = treatMissing
          }
        }
        return config
      }
    )
  } 
}

class Plugin {
  constructor (serverless, options) {
    this.serverless = serverless
    this.hooks = {
      'package:compileEvents': this.beforeDeployResources.bind(this)
    }
  }

  beforeDeployResources () {
    if (!this.serverless.service.custom || !this.serverless.service.custom['SuccessRateAlarm']) {
      return
    }

    const alarms = this.serverless.service.custom['SuccessRateAlarm'].map(
      data => new Alarm(data, this.serverless.getProvider('aws').getRegion())
    )

    alarms.forEach(
      alarm => alarm.ressources().forEach(
        ressource => {
          _.merge(
            this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
            ressource
          )
        }
      )
    )
  }
}

module.exports = Plugin
