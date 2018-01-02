'use strict'

const util = require('./util')
const doc = require('./doc')
const uri = require('./uri')
const graph = require('./graph')
const fetcher = require('./fetcher')
const Config = require('./config')

module.exports = {
  getEndpoint,
  getEndpointFromHead,
  getEndpointFromRDF,
  notifyInbox,
  sendNotifications
}

function sendNotifications (tos, note, iri, shareResource) {
  return new Promise((resolve, reject) => {
    var notificationData = {
      'type': ['as:Announce'],
      'object': iri,
      'summary': note,
      'license': 'https://creativecommons.org/licenses/by/4.0/'
    }

    let data = doc.getDocument()

    let options = {
      'contentType': 'text/html',
      'subjectURI': iri
    }
    var spo = {
      'subject': iri,
      'predicate': Config.Vocab['rdftype']['@id']
    }

    graph.getMatchFromData(data, spo, options)
      .then(supplementalData => {
        if (typeof supplementalData !== 'undefined' && supplementalData._array.length > 0) {
          notificationData['objectTypes'] = supplementalData._array
        }

        let spo = {
          'subject': iri,
          'predicate': Config.Vocab['schemalicense']['@id']
        }

        return graph.getMatchFromData(data, spo, options)
          .then(data => {
            if (typeof data !== 'undefined' && data.length > 0) {
              notificationData['objectLicense'] = data
            }
          })
      })
      .then(() => {
        tos.forEach(to => {
          notificationData['to'] = to

          var toInput = shareResource.querySelector('[value="' + to + '"]') ||
            shareResource.querySelector('#share-resource-to')

          toInput.parentNode.insertAdjacentHTML('beforeend',
            '<span class="progress" data-to="' + to +
            '"><i class="fa fa-circle-o-notch fa-spin fa-fw"></i></span>')

          inboxResponse(to, toInput)

            .then(inboxURL => {
              notificationData['inbox'] = inboxURL

              notifyInbox(notificationData)

                .catch(error => {
                  console.log('Error in notifyInbox:', error)
                  toInput
                    .parentNode
                    .querySelector('.progress[data-to="' + to + '"]')
                    .innerHTML = '<i class="fa fa-times-circle fa-fw "></i> Unable to notify. Try later.'
                })

                .then(response => {
                    var location = response.headers.get('Location')

                    if (location) {
                      location = uri.getAbsoluteIRI(inboxURL, location)

                      toInput
                        .parentNode
                        .querySelector('.progress[data-to="' + to + '"]')
                        .innerHTML = '<a target="_blank" href="' +
                        location + '"><i class="fa fa-check-circle fa-fw"></i></a>'
                    }
                  }
                )
            })
        })
      })
  })
}

function inboxResponse (to, toInput) {
  return getEndpoint(Config.Vocab['ldpinbox']['@id'], to)
    .then(inboxes => inboxes[0])

    .catch(error => {
      console.log('Error in inboxResponse:', error)

      toInput
        .parentNode
        .querySelector('.progress[data-to="' + to + '"]')
        .innerHTML = '<i class="fa fa-times-circle fa-fw"></i> Inbox not responding. Try later.'
    })
}

function notifyInbox (o) {
  var slug, inboxURL

  if ('slug' in o) {
    slug = o.slug
  }
  if ('inbox' in o) {
    inboxURL = o.inbox
  }

  if (!inboxURL) {
    return Promise.reject(new Error('No inbox to send notification to'))
  }

  var data = DO.U.createActivityHTML(o)

  data = DO.U.createHTML(title, data, { 'prefixes': Config.Prefixes })

  var options = {
    'contentType': 'text/html',
    'profile': 'https://www.w3.org/ns/activitystreams'
  }

  var pIRI = uri.getProxyableIRI(inboxURL)
  return postActivity(pIRI, slug, data, options)
}

function postActivity(url, slug, data, options) {
  return fetcher.getAcceptPostPreference(url)
    .then(preferredContentType => {
      switch (preferredContentType) {
        case 'text/html':
        case 'application/xhtml+xml':
          return fetcher.postResource(url, slug, data, 'text/html; charset=utf-8')

        case 'text/turtle':
          // FIXME: proxyURL + http URL doesn't work. https://github.com/solid/node-solid-server/issues/351

          return graph.getGraphFromData(data, options)
            .then(g => {
              return graph.serializeGraph(g, { 'contentType': 'text/turtle' })
            })
            .then(data => {
              return fetcher.postResource(url, slug, data, 'text/turtle')
            })

        case 'application/ld+json':
        case 'application/json':
        case '*/*':
        default:
          return graph.getGraphFromData(data, options)
            .then(g => {
              return graph.serializeGraph(g, { 'contentType': 'application/ld+json', 'context': { '@context': 'https://www.w3.org/ns/activitystreams' }})
            })
            .then(serialized => {
              let data = JSON.stringify(serialized) + '\n'

              var profile = ('profile' in options) ? '; profile="' + options.profile + '"' : ''

              return fetcher.postResource(url, slug, data, preferredContentType + profile)
            })
      }
    })
}

function getEndpoint (property, url) {
  if (url) {
    return getEndpointFromHead(property, url)
      .catch(() => getEndpointFromRDF(property, url))
  } else {
    var subjectURI = window.location.href.split(window.location.search || window.location.hash || /[?#]/)[0]

    var options = {
      'contentType': 'text/html',
      'subjectURI': subjectURI
    }

    return graph.getGraphFromData(doc.getDocument(), options)
      .then(function (result) {
          // TODO: Should this get all of the inboxes or a given subject's?
          var endpoints = result.match(subjectURI, property).toArray()
          if (endpoints.length > 0) {
            return endpoints.map(function(t){ return t.object.nominalValue })
          }

// console.log(property + ' endpoint was not found in message body')
          return getEndpointFromHead(property, subjectURI)
        })
      .catch(() => getEndpointFromHead(property, subjectURI))
  }
}

function getEndpointFromHead (property, url) {
  var pIRI = uri.getProxyableIRI(url);

  return fetcher.getResourceHead(pIRI, {'header': 'Link'}).then(
    function (i) {
      var linkHeaders = fetcher.parseLinkHeader(i.headers)

      if (property in linkHeaders) {
        return linkHeaders[property]
      }
      return Promise.reject({'message': property + " endpoint was not found in 'Link' header"})
    },
    function (reason) {
      return Promise.reject({'message': "'Link' header not found"})
    }
  );
}

function getEndpointFromRDF (property, url, subjectIRI) {
  url = url || window.location.origin + window.location.pathname
  subjectIRI = subjectIRI || url

  return fetcher.getResourceGraph(subjectIRI)
    .then(function (i) {
        var s = i.child(subjectIRI)

        switch (property) {
          case Config.Vocab['ldpinbox']['@id']:
            if (s.ldpinbox._array.length > 0){
// console.log(s.ldpinbox._array)
              return [s.ldpinbox.at(0)]
            }
            break
          case Config.Vocab['oaannotationService']['@id']:
            if (s.oaannotationService._array.length > 0){
// console.log(s.oaannotationService._array)
              return [s.oaannotationService.at(0)]
            }
            break
        }

        throw new Error(property + ' endpoint was not found in message body')
      }
    )
}
