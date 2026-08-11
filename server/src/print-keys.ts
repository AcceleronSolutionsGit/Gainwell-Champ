import dotenv from 'dotenv'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') })

async function printKeys() {
  const baseUrl = 'https://onegainwellonehr.darwinbox.in'
  const reportId = process.env.DARWINBOX_REPORT_ID || '434f3b9129645b'
  const apiKey = process.env.DARWINBOX_API_KEY || '9d17fa8d9932a369daf2c786c77c18406789903953e3675c7c27869318ceda53c3c4afd5b3e177677112f4faf02945fdfbd612f79a7a561b516d6aed28867eb7'
  const basicAuthUser = process.env.DARWINBOX_BASIC_AUTH_USER || 'PwC_1234'
  const basicAuthPass = process.env.DARWINBOX_BASIC_AUTH_PASS || 'PwC_1234'

  const encoded = Buffer.from(`${basicAuthUser}:${basicAuthPass}`).toString('base64')
  const headers = {
    Authorization: `Basic ${encoded}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  const url = `${baseUrl}/reportsbuilderapi/reportdatav2`
  const body = {
    api_key: apiKey,
    report_id: reportId,
    get_latest_report: '1',
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const rawJson: any = await res.json()
    const firstEmp = rawJson.response?.data?.[0]
    if (firstEmp) {
      console.log('Keys in Darwinbox Employee object:')
      console.log(Object.keys(firstEmp))
      console.log('Sample Data:')
      console.log(JSON.stringify(firstEmp, null, 2))
    } else {
      console.log('No employee data returned')
    }
  } catch (error) {
    console.error('Request failed:', error)
  }
}

printKeys()
