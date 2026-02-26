import './style.css'

function onFeedbackComplete() {
  // Called when feedback form is successfully submitted
  console.log('Feedback submitted successfully!')
  // Add your custom logic here (e.g. show thank-you message, analytics, etc.)
}

function initFeedbackForm() {
  const form = document.getElementById('feedback-form') as HTMLFormElement
  const iframe = document.getElementById('feedback-form-iframe') as HTMLIFrameElement

  if (!form || !iframe) return

  iframe.addEventListener('load', () => {
    if ((form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted) {
      onFeedbackComplete()
      form.reset()
      ;(form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted = false
    }
  })

  form.addEventListener('submit', () => {
    ;(form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted = true
  })
}

initFeedbackForm()
