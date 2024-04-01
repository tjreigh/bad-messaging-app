const ready = callback => {
    if (document.readyState != "loading") callback()
    else document.addEventListener("DOMContentLoaded", callback)
}

ready(() => {
    const messageForm = document.getElementById('message-send-form')
    const messageViewer = document.getElementById('message-viewer')
    let messages = []

    messageForm.addEventListener('submit', (event) => {
        event.preventDefault()
        const formData = new FormData(event.target)
        const message = formData.get("message")
        messages.push(message)
        const newMessage = document.createElement('p')
        newMessage.textContent = message
        messageViewer.appendChild(newMessage)
    })
})